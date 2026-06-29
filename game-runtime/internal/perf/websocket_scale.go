package perf

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"commanderzone/game-runtime/internal/gateway"
	runtimesvc "commanderzone/game-runtime/internal/runtime"

	"github.com/gorilla/websocket"
)

const benchmarkTicketSecret = "runtime-benchmark-ticket-secret"

type wsBenchConn struct {
	conn          *websocket.Conn
	frames        chan gateway.ServerMessage
	receivedBytes atomic.Int64
}

func runWebSocketScale(ctx context.Context, config Config, runtimeService *runtimesvc.Service, gameCount int, acc *scaleAccumulator) (int, int64, error) {
	validator, err := gateway.NewHMACTicketValidator(benchmarkTicketSecret)
	if err != nil {
		return 0, 0, err
	}
	handler := gateway.NewWebSocketServer(
		validator,
		runtimeService,
		gateway.WithConnectionQueueSize(config.QueueSize),
		gateway.WithPatchHistoryLimit(512),
	)
	server := httptest.NewServer(handler)
	defer server.Close()

	connectionsByGame := map[string][]*wsBenchConn{}
	commandConnByGameAndPlayer := map[string]map[string]*wsBenchConn{}
	target := config.Connections
	minimum := gameCount * 4
	if target < minimum {
		target = minimum
	}
	opened := 0
	for gameIndex := 0; gameIndex < gameCount; gameIndex++ {
		for playerIndex := 0; playerIndex < 4; playerIndex++ {
			gameID := fmt.Sprintf("bench-game-%03d", gameIndex+1)
			playerID := fmt.Sprintf("p%d", playerIndex+1)
			conn, err := openBenchmarkWebSocket(server.URL, gameID, playerID, 0)
			if err != nil {
				closeBenchmarkConnections(connectionsByGame)
				return opened, totalWebSocketBytes(connectionsByGame), err
			}
			opened++
			connectionsByGame[gameID] = append(connectionsByGame[gameID], conn)
			if commandConnByGameAndPlayer[gameID] == nil {
				commandConnByGameAndPlayer[gameID] = map[string]*wsBenchConn{}
			}
			commandConnByGameAndPlayer[gameID][playerID] = conn
		}
	}
	for opened < target {
		gameIndex := opened % gameCount
		playerIndex := opened % 4
		gameID := fmt.Sprintf("bench-game-%03d", gameIndex+1)
		playerID := fmt.Sprintf("p%d", playerIndex+1)
		conn, err := openBenchmarkWebSocket(server.URL, gameID, playerID, 0)
		if err != nil {
			closeBenchmarkConnections(connectionsByGame)
			return opened, totalWebSocketBytes(connectionsByGame), err
		}
		opened++
		connectionsByGame[gameID] = append(connectionsByGame[gameID], conn)
	}
	defer closeBenchmarkConnections(connectionsByGame)

	for iteration := 0; iteration < config.Iterations; iteration++ {
		for _, spec := range commandSequence() {
			var wg sync.WaitGroup
			for gameIndex := 0; gameIndex < gameCount; gameIndex++ {
				gameIndex := gameIndex
				wg.Add(1)
				go func() {
					defer wg.Done()
					gameID := fmt.Sprintf("bench-game-%03d", gameIndex+1)
					gameActor, ok := runtimeService.Actor(gameID)
					if !ok {
						acc.addError(spec.commandType, "actor_missing")
						return
					}
					snapshot := gameActor.Snapshot()
					payload, actorID, skip := spec.payload(snapshot, iteration, gameIndex)
					if skip {
						return
					}
					commandConn := commandConnByGameAndPlayer[gameID][actorID]
					if commandConn == nil {
						acc.addError(spec.commandType, "command_connection_missing")
						return
					}
					clientActionID := fmt.Sprintf("%s-%02d-%03d", spec.name, iteration+1, gameIndex+1)
					command := gateway.ClientMessage{
						Kind:           "command.v2",
						GameID:         gameID,
						BaseVersion:    gameActor.Version(),
						ClientActionID: clientActionID,
						Type:           spec.commandType,
						Payload:        payload,
						Client:         map[string]any{"source": "runtime-bench"},
					}
					start := time.Now()
					if err := commandConn.conn.WriteJSON(command); err != nil {
						acc.addSample(sample{commandType: spec.commandType, err: err.Error()})
						acc.addError(spec.commandType, err.Error())
						return
					}
					frame, err := commandConn.waitForAck(ctx, clientActionID, 5*time.Second)
					latencyMs := float64(time.Since(start).Microseconds()) / 1000
					if err != nil {
						acc.addSample(sample{commandType: spec.commandType, latencyMs: latencyMs, err: err.Error()})
						acc.addError(spec.commandType, err.Error())
						return
					}
					resync := frame.Kind == "resync_required" || frame.Status == "resync_required"
					acc.addSample(sample{commandType: spec.commandType, latencyMs: latencyMs, patchBytes: jsonSize(frame), resync: resync})
				}()
			}
			wg.Wait()
		}
	}

	for gameIndex := 0; gameIndex < gameCount; gameIndex++ {
		gameID := fmt.Sprintf("bench-game-%03d", gameIndex+1)
		gameActor, ok := runtimeService.Actor(gameID)
		if !ok {
			continue
		}
		lastApplied := gameActor.Version() - 1
		if lastApplied < 1 {
			lastApplied = 1
		}
		start := time.Now()
		conn, err := openBenchmarkWebSocket(server.URL, gameID, "p1", lastApplied)
		if err != nil {
			acc.addError("reconnect", err.Error())
			continue
		}
		frame, err := conn.waitForKind(ctx, 5*time.Second, "patch.v2", "resync_required")
		acc.addReconnectLatency(float64(time.Since(start).Microseconds()) / 1000)
		if err != nil {
			acc.addError("reconnect", err.Error())
		} else if frame.Kind == "resync_required" {
			acc.addSample(sample{commandType: "reconnect", resync: true})
		}
		_ = conn.conn.Close()
	}

	return opened, totalWebSocketBytes(connectionsByGame), nil
}

func openBenchmarkWebSocket(serverURL string, gameID string, playerID string, lastAppliedVersion int64) (*wsBenchConn, error) {
	ticket, err := gateway.SignTicket(benchmarkTicketSecret, gateway.TicketClaims{
		UserID:      playerID,
		PlayerID:    playerID,
		GameID:      gameID,
		Role:        "player",
		Permissions: []string{"view", "command"},
		Protocol:    "v2",
	}, time.Hour)
	if err != nil {
		return nil, err
	}
	wsURL := gateway.URLWithTicket("ws"+strings.TrimPrefix(serverURL, "http")+"/ws", ticket, lastAppliedVersion)
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		return nil, err
	}
	benchConn := &wsBenchConn{
		conn:   conn,
		frames: make(chan gateway.ServerMessage, 2048),
	}
	go benchConn.readLoop()
	if _, err := benchConn.waitForKind(context.Background(), 5*time.Second, "connection_state"); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return benchConn, nil
}

func (c *wsBenchConn) readLoop() {
	for {
		_, payload, err := c.conn.ReadMessage()
		if err != nil {
			close(c.frames)
			return
		}
		c.receivedBytes.Add(int64(len(payload)))
		var message gateway.ServerMessage
		if err := json.Unmarshal(payload, &message); err != nil {
			continue
		}
		select {
		case c.frames <- message:
		default:
		}
	}
}

func (c *wsBenchConn) waitForAck(ctx context.Context, clientActionID string, timeout time.Duration) (gateway.ServerMessage, error) {
	deadline, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	for {
		select {
		case <-deadline.Done():
			return gateway.ServerMessage{}, deadline.Err()
		case message, ok := <-c.frames:
			if !ok {
				return gateway.ServerMessage{}, fmt.Errorf("websocket closed")
			}
			if message.Kind == "patch.v2" && message.AckClientActionID == clientActionID {
				return message, nil
			}
			if message.Kind == "command_ack" && message.ClientActionID == clientActionID {
				return message, nil
			}
			if message.Kind == "error" && message.ClientActionID == clientActionID {
				return message, fmt.Errorf("runtime websocket error: %v", message.Error)
			}
		}
	}
}

func (c *wsBenchConn) waitForKind(ctx context.Context, timeout time.Duration, kinds ...string) (gateway.ServerMessage, error) {
	wanted := map[string]bool{}
	for _, kind := range kinds {
		wanted[kind] = true
	}
	deadline, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	for {
		select {
		case <-deadline.Done():
			return gateway.ServerMessage{}, deadline.Err()
		case message, ok := <-c.frames:
			if !ok {
				return gateway.ServerMessage{}, fmt.Errorf("websocket closed")
			}
			if wanted[message.Kind] {
				return message, nil
			}
		}
	}
}

func closeBenchmarkConnections(connectionsByGame map[string][]*wsBenchConn) {
	for _, connections := range connectionsByGame {
		for _, conn := range connections {
			_ = conn.conn.Close()
		}
	}
}

func totalWebSocketBytes(connectionsByGame map[string][]*wsBenchConn) int64 {
	total := int64(0)
	for _, connections := range connectionsByGame {
		for _, conn := range connections {
			total += conn.receivedBytes.Load()
		}
	}
	return total
}
