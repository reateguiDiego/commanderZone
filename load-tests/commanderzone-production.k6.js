import http from 'k6/http';
import ws from 'k6/ws';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const API_BASE_URL = (__ENV.API_BASE_URL || 'https://api.commanderzone.com').replace(/\/+$/, '');
const USERS_REQUESTED = parseInt(__ENV.USERS || '100', 10);
const DRY_RUN = (__ENV.DRY_RUN || '') === '1';
const ACTIVE_USERS = DRY_RUN ? 4 : USERS_REQUESTED;
const USER_PASSWORD = __ENV.USER_PASSWORD || '';
const RUN_ID = __ENV.RUN_ID || `czlt-${Date.now()}`;
const PHASE_NAME = __ENV.PHASE_NAME || `${USERS_REQUESTED}`;
const DECK_NAME = __ENV.DECK_NAME || 'Load Test Deck';
const DURATION = __ENV.DURATION || (DRY_RUN ? '30s' : '10m');
const HOLD_MS = durationToMs(DURATION);
const COMMAND_INTERVAL_MS = Math.max(250, parseInt(__ENV.COMMAND_INTERVAL_MS || '2000', 10));
const ROOM_SIZE = 4;

const httpEndpointMs = new Trend('cz_http_endpoint_ms', true);
const wsConnectMs = new Trend('cz_ws_connect_ms', true);
const wsCommandAckMs = new Trend('cz_ws_command_ack_ms', true);
const wsCommandErrorRate = new Rate('cz_ws_command_error_rate');
const wsCommandResyncRate = new Rate('cz_ws_command_resync_rate');
const setupFailureRate = new Rate('cz_setup_failure_rate');
const cleanupFailureRate = new Rate('cz_cleanup_failure_rate');
const commandsSent = new Counter('cz_ws_commands_sent');
const socketsOpened = new Counter('cz_ws_sockets_opened');
const setupGames = new Counter('cz_setup_games');

let runManifest = null;

export const options = {
  setupTimeout: '45m',
  teardownTimeout: '20m',
  scenarios: {
    commander_load: {
      executor: 'constant-vus',
      vus: ACTIVE_USERS,
      duration: DURATION,
      gracefulStop: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    cz_ws_command_error_rate: ['rate<0.01'],
    cz_ws_command_resync_rate: ['rate<0.005'],
    cz_ws_command_ack_ms: ['p(95)<750', 'p(99)<2000'],
    cz_ws_connect_ms: ['p(95)<1500'],
    cz_setup_failure_rate: ['rate<0.001'],
    cz_cleanup_failure_rate: ['rate<0.001'],
  },
  summaryTrendStats: ['min', 'avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  assertConfig();
  const startedAt = new Date().toISOString();
  const users = [];
  for (let index = 1; index <= ACTIVE_USERS; index += 1) {
    const user = loginSeedUser(index);
    ensureUserCanJoinNewRoom(user);
    user.deckId = findLoadTestDeckId(user);
    users.push(user);
  }

  const games = [];
  for (let offset = 0; offset < users.length; offset += ROOM_SIZE) {
    const tableUsers = users.slice(offset, offset + ROOM_SIZE);
    if (tableUsers.length !== ROOM_SIZE) {
      throw new Error(`Phase requires groups of ${ROOM_SIZE}; got trailing group size ${tableUsers.length}.`);
    }
    const game = createStartedCommanderGame(tableUsers, games.length + 1);
    games.push(game);
    setupGames.add(1);
  }

  for (const game of games) {
    for (let seat = 0; seat < game.users.length; seat += 1) {
      const user = game.users[seat];
      user.gameId = game.gameId;
      user.roomId = game.roomId;
      user.gameIndex = game.index;
      user.seatIndex = seat;
      user.driver = seat === 0;
    }
  }

  runManifest = {
    runId: RUN_ID,
    phase: PHASE_NAME,
    usersRequested: USERS_REQUESTED,
    activeUsers: ACTIVE_USERS,
    dryRun: DRY_RUN,
    apiBaseUrl: API_BASE_URL,
    deckName: DECK_NAME,
    duration: DURATION,
    commandIntervalMs: COMMAND_INTERVAL_MS,
    startedAt,
    games: games.map((game) => ({
      index: game.index,
      roomId: game.roomId,
      gameId: game.gameId,
      userEmails: game.users.map((user) => user.email),
      userIds: game.users.map((user) => user.id),
    })),
  };

  return {
    manifest: runManifest,
    users: games.flatMap((game) => game.users),
  };
}

export default function (data) {
  if (!data || !Array.isArray(data.users)) {
    setupFailureRate.add(1);
    throw new Error('Load-test setup data is missing. Run the scenario without --no-setup.');
  }

  const user = data.users[__VU - 1];
  if (!user) {
    setupFailureRate.add(1);
    throw new Error(`No seeded user data for VU ${__VU}.`);
  }

  const ticket = runtimeTicket(user.gameId, user.token);
  const driverState = user.driver ? loadDriverState(user) : null;
  const connectedAt = Date.now();
  const response = ws.connect(ticket.websocketUrl, {}, (socket) => {
    let currentVersion = driverState ? driverState.version : 1;
    let pending = null;
    let closed = false;
    const context = {
      user,
      movedInstanceId: driverState ? driverState.handInstanceId : null,
      moveSent: false,
      drawCount: 0,
      lifeDelta: -1,
      positionStep: 0,
    };

    socket.on('open', () => {
      socketsOpened.add(1);
      wsConnectMs.add(Date.now() - connectedAt);
    });

    socket.on('message', (raw) => {
      const frame = parseJson(raw);
      if (!frame) {
        return;
      }
      if (frame.kind === 'resync_required' || frame.status === 'resync_required') {
        wsCommandResyncRate.add(true);
        wsCommandErrorRate.add(true);
        pending = null;
        if (typeof frame.currentVersion === 'number' && frame.currentVersion > 0) {
          currentVersion = frame.currentVersion;
        }
        return;
      }
      if (frame.kind === 'error') {
        wsCommandErrorRate.add(true);
        pending = null;
        return;
      }
      if (frame.kind === 'command_ack' && pending && frame.clientActionId === pending.clientActionId) {
        if (frame.status !== 'duplicate') {
          wsCommandErrorRate.add(true);
        }
        pending = null;
        return;
      }
      if (frame.kind !== 'patch.v2' || !pending || frame.ackClientActionId !== pending.clientActionId) {
        return;
      }

      const elapsed = Date.now() - pending.sentAt;
      wsCommandAckMs.add(elapsed, { command_type: pending.type });
      wsCommandErrorRate.add(false);
      wsCommandResyncRate.add(false);
      if (typeof frame.version === 'number' && frame.version > 0) {
        currentVersion = frame.version;
      }
      pending = null;
    });
    socket.on('error', () => {
      wsCommandErrorRate.add(true);
      pending = null;
    });

    if (user.driver) {
      socket.setInterval(() => {
        if (closed || pending) {
          return;
        }
        const command = nextDriverCommand(context);
        if (!command) {
          return;
        }
        pending = sendRuntimeCommand(socket, user, currentVersion, command);
      }, COMMAND_INTERVAL_MS);

      socket.setTimeout(() => {
        if (closed || pending) {
          return;
        }
        pending = sendRuntimeCommand(socket, user, currentVersion, {
          type: 'game.close',
          payload: {},
        });
      }, Math.max(1000, HOLD_MS - 3000));
    }

    socket.setTimeout(() => {
      closed = true;
      socket.close();
    }, HOLD_MS);
  });

  check(response, {
    'runtime websocket upgrade succeeded': (result) => result && result.status === 101,
  });
}

export function teardown(data) {
  if (!data || !data.manifest || !Array.isArray(data.manifest.games)) {
    cleanupFailureRate.add(1);
    return;
  }

  runManifest = data.manifest || runManifest;
  for (const game of data.manifest.games || []) {
    const owner = data.users.find((user) => user.gameId === game.gameId && user.driver);
    if (!owner) {
      cleanupFailureRate.add(1);
      continue;
    }
    try {
      closeGameBestEffort(owner);
      cleanupFailureRate.add(false);
    } catch (error) {
      cleanupFailureRate.add(true);
      console.error(`Cleanup failed for game ${game.gameId}: ${String(error)}`);
    }
  }
}

export function handleSummary(data) {
  const manifest = runManifest || {
    runId: RUN_ID,
    phase: PHASE_NAME,
    usersRequested: USERS_REQUESTED,
    activeUsers: ACTIVE_USERS,
    dryRun: DRY_RUN,
    apiBaseUrl: API_BASE_URL,
    duration: DURATION,
    games: [],
  };
  const markdown = markdownSummary(data, manifest);
  return {
    stdout: markdown,
    '/reports/k6-summary.json': JSON.stringify(data, null, 2),
    '/reports/k6-summary.md': markdown,
    '/reports/manifest.json': JSON.stringify(manifest, null, 2),
  };
}

function assertConfig() {
  if (![100, 280, 500].includes(USERS_REQUESTED)) {
    throw new Error(`USERS must be one of 100, 280, or 500. Received: ${USERS_REQUESTED}`);
  }
  if (ACTIVE_USERS % ROOM_SIZE !== 0) {
    throw new Error(`Active users must be divisible by ${ROOM_SIZE}. Received: ${ACTIVE_USERS}`);
  }
  if (!USER_PASSWORD) {
    throw new Error('USER_PASSWORD is required.');
  }
}

function loginSeedUser(index) {
  const username = `test${index < 100 ? String(index).padStart(2, '0') : String(index)}`;
  const email = `${username}@test.com`;
  const response = postJson('/auth/login', {
    email,
    password: USER_PASSWORD,
  }, null, 'auth.login');
  const body = expectJson(response, `login ${email}`);
  const token = String(body.token || '');
  if (!token) {
    setupFailureRate.add(1);
    throw new Error(`Login response for ${email} did not include token.`);
  }
  const user = body.user || currentUser(token);
  if (!user || !user.id) {
    setupFailureRate.add(1);
    throw new Error(`Could not resolve user id for ${email}.`);
  }
  setupFailureRate.add(false);
  return {
    index,
    email,
    token,
    id: String(user.id),
    displayName: String(user.displayName || username),
  };
}

function currentUser(token) {
  const response = getJson('/me', token, 'me');
  return expectJson(response, 'load current user').user;
}

function ensureUserCanJoinNewRoom(user) {
  const response = getJson('/rooms/current', user.token, 'rooms.current');
  if (!response || !response.body) {
    return;
  }
  const body = response.json();
  const roomId = body && body.room && body.room.id ? String(body.room.id) : '';
  if (!roomId) {
    return;
  }
  const leave = postJson(`/rooms/${roomId}/leave`, {}, user.token, 'rooms.leave');
  if (![200, 201, 204, 404].includes(leave.status)) {
    setupFailureRate.add(1);
    throw new Error(`Could not leave existing room ${roomId} for ${user.email}: ${leave.status} ${leave.body}`);
  }
}

function findLoadTestDeckId(user) {
  const response = getJson('/decks', user.token, 'decks.list');
  const body = expectJson(response, `list decks for ${user.email}`);
  const decks = Array.isArray(body.data) ? body.data : [];
  const deck = decks.find((candidate) => candidate && candidate.name === DECK_NAME)
    || decks.find((candidate) => candidate && candidate.name && String(candidate.name).includes(DECK_NAME));
  if (!deck || !deck.id) {
    setupFailureRate.add(1);
    throw new Error(`Seed deck "${DECK_NAME}" not found for ${user.email}.`);
  }
  return String(deck.id);
}

function createStartedCommanderGame(users, gameIndex) {
  const owner = users[0];
  const roomName = `${RUN_ID}-${PHASE_NAME}-${String(gameIndex).padStart(3, '0')}`;
  const roomResponse = postJson('/rooms', {
    deckId: owner.deckId,
    visibility: 'private',
    name: roomName,
    format: 'commander',
    maxPlayers: ROOM_SIZE,
    mulliganRule: 'LONDON',
    firstMulliganFree: true,
  }, owner.token, 'rooms.create');
  const roomBody = expectJson(roomResponse, `create room ${roomName}`);
  const roomId = String(roomBody.room && roomBody.room.id ? roomBody.room.id : '');
  if (!roomId) {
    setupFailureRate.add(1);
    throw new Error(`Room creation did not return room id for ${roomName}.`);
  }

  for (let seat = 1; seat < users.length; seat += 1) {
    const player = users[seat];
    const joinResponse = postJson(`/rooms/${roomId}/join`, {
      deckId: player.deckId,
    }, player.token, 'rooms.join');
    expectOk(joinResponse, `join room ${roomId} as ${player.email}`);
  }

  resolveTurnOrder(roomId, users);
  const startResponse = postJson(`/rooms/${roomId}/start`, {}, owner.token, 'rooms.start');
  const startBody = expectJson(startResponse, `start room ${roomId}`);
  const gameId = String(startBody.game && startBody.game.id ? startBody.game.id : '');
  if (!gameId) {
    setupFailureRate.add(1);
    throw new Error(`Room ${roomId} did not return game id.`);
  }

  return {
    index: gameIndex,
    roomId,
    gameId,
    users,
  };
}

function resolveTurnOrder(roomId, users) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const roomResponse = getJson(`/rooms/${roomId}`, users[0].token, 'rooms.show');
    const roomBody = expectJson(roomResponse, `load room ${roomId}`);
    const players = roomBody.room && Array.isArray(roomBody.room.players) ? roomBody.room.players : [];
    if (turnOrderResolved(players)) {
      return;
    }
    for (const user of users) {
      const rollResponse = postJson(`/rooms/${roomId}/roll-turn`, {}, user.token, 'rooms.roll_turn');
      if (rollResponse.status >= 200 && rollResponse.status < 300) {
        continue;
      }
      if (rollResponse.status === 409 && String(rollResponse.body || '').includes('Turn order has already been rolled')) {
        continue;
      }
      setupFailureRate.add(1);
      throw new Error(`Turn roll failed for room ${roomId}, user ${user.email}: ${rollResponse.status} ${rollResponse.body}`);
    }
  }
  setupFailureRate.add(1);
  throw new Error(`Could not resolve unique turn order for room ${roomId}.`);
}

function turnOrderResolved(players) {
  if (!Array.isArray(players) || players.length !== ROOM_SIZE) {
    return false;
  }
  const seen = {};
  for (const player of players) {
    if (!Array.isArray(player.turnRolls) || player.turnRolls.length === 0) {
      return false;
    }
    const key = player.turnRolls.join('-');
    if (seen[key]) {
      return false;
    }
    seen[key] = true;
  }
  return true;
}

function runtimeTicket(gameId, token) {
  const response = postJson(`/games/${gameId}/websocket-ticket`, {}, token, 'games.websocket_ticket');
  const body = expectJson(response, `create runtime ticket for ${gameId}`);
  if (body.route !== 'runtime_ws' || !body.websocketUrl) {
    throw new Error(`Expected runtime_ws ticket for ${gameId}, got ${JSON.stringify(body)}`);
  }
  return body;
}

function loadDriverState(user) {
  const response = getJson(`/games/${user.gameId}/snapshot`, user.token, 'games.snapshot');
  const body = expectJson(response, `load snapshot for ${user.gameId}`);
  const snapshot = body.game && body.game.snapshot ? body.game.snapshot : {};
  const player = snapshot.players && snapshot.players[user.id] ? snapshot.players[user.id] : {};
  const zones = player.zones || {};
  const hand = Array.isArray(zones.hand) ? zones.hand : [];
  const handCard = hand.find((card) => card && typeof card.instanceId === 'string');
  return {
    version: Math.max(1, Number(snapshot.version || 1)),
    handInstanceId: handCard ? String(handCard.instanceId) : null,
  };
}

function nextDriverCommand(context) {
  if (!context.moveSent && context.movedInstanceId) {
    context.moveSent = true;
    return {
      type: 'card.moved',
      payload: {
        playerId: context.user.id,
        fromZone: 'hand',
        toZone: 'battlefield',
        instanceId: context.movedInstanceId,
        position: { x: 0.35, y: 0.55, unit: 'ratio' },
      },
    };
  }
  if (context.movedInstanceId && context.positionStep % 5 === 0) {
    context.positionStep += 1;
    return {
      type: 'card.tapped',
      payload: {
        playerId: context.user.id,
        zone: 'battlefield',
        instanceId: context.movedInstanceId,
        tapped: context.positionStep % 2 === 0,
      },
    };
  }
  if (context.movedInstanceId && context.positionStep % 3 === 0) {
    context.positionStep += 1;
    return {
      type: 'card.position.changed',
      payload: {
        playerId: context.user.id,
        zone: 'battlefield',
        instanceId: context.movedInstanceId,
        position: {
          x: 0.2 + ((context.positionStep % 6) * 0.08),
          y: 0.45 + ((context.positionStep % 4) * 0.05),
          unit: 'ratio',
        },
      },
    };
  }
  if (context.drawCount < 30 && context.positionStep % 4 === 0) {
    context.drawCount += 1;
    context.positionStep += 1;
    return {
      type: 'library.draw',
      payload: {
        playerId: context.user.id,
      },
    };
  }
  context.positionStep += 1;
  context.lifeDelta = context.lifeDelta === -1 ? 1 : -1;
  return {
    type: 'life.changed',
    payload: {
      playerId: context.user.id,
      delta: context.lifeDelta,
    },
  };
}

function sendRuntimeCommand(socket, user, baseVersion, command) {
  const clientActionId = `${RUN_ID}-${user.gameIndex}-${user.seatIndex}-${command.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const envelope = {
    kind: 'command.v2',
    gameId: user.gameId,
    messageId: clientActionId,
    baseVersion,
    clientActionId,
    type: command.type,
    payload: command.payload || {},
    client: {
      source: 'commanderzone-production-load-test',
      runId: RUN_ID,
      phase: PHASE_NAME,
      userIndex: user.index,
    },
  };
  socket.send(JSON.stringify(envelope));
  commandsSent.add(1, { command_type: command.type });
  return {
    clientActionId,
    type: command.type,
    sentAt: Date.now(),
  };
}

function closeGameBestEffort(owner) {
  const snapshotResponse = getJson(`/games/${owner.gameId}/snapshot`, owner.token, 'cleanup.snapshot');
  if (snapshotResponse.status === 404 || snapshotResponse.status === 403) {
    return;
  }
  const snapshotBody = expectJson(snapshotResponse, `cleanup snapshot ${owner.gameId}`);
  const version = Math.max(1, Number(snapshotBody.game && snapshotBody.game.snapshot ? snapshotBody.game.snapshot.version || 1 : 1));
  const ticket = runtimeTicket(owner.gameId, owner.token);
  const response = ws.connect(ticket.websocketUrl, {}, (socket) => {
    let settled = false;
    socket.on('open', () => {
      sendRuntimeCommand(socket, owner, version, {
        type: 'game.close',
        payload: {},
      });
    });
    socket.on('message', (raw) => {
      const frame = parseJson(raw);
      if (!frame || settled) {
        return;
      }
      if (frame.kind === 'patch.v2' || frame.kind === 'error' || frame.kind === 'resync_required') {
        settled = true;
        socket.close();
      }
    });
    socket.setTimeout(() => {
      socket.close();
    }, 5000);
  });
  if (!response || response.status !== 101) {
    throw new Error(`cleanup websocket upgrade failed for ${owner.gameId}`);
  }
}

function postJson(path, payload, token, name) {
  const started = Date.now();
  const response = http.post(`${API_BASE_URL}${path}`, JSON.stringify(payload || {}), {
    headers: jsonHeaders(token),
    tags: { endpoint: name },
    timeout: '30s',
  });
  httpEndpointMs.add(Date.now() - started, { endpoint: name });
  return response;
}

function getJson(path, token, name) {
  const started = Date.now();
  const response = http.get(`${API_BASE_URL}${path}`, {
    headers: jsonHeaders(token),
    tags: { endpoint: name },
    timeout: '30s',
  });
  httpEndpointMs.add(Date.now() - started, { endpoint: name });
  return response;
}

function jsonHeaders(token) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': `CommanderZoneLoadTest/${RUN_ID}`,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function expectJson(response, action) {
  expectOk(response, action);
  try {
    return response.json();
  } catch (error) {
    setupFailureRate.add(1);
    throw new Error(`Invalid JSON while trying to ${action}: ${String(error)}. Body: ${response.body}`);
  }
}

function expectOk(response, action) {
  if (response && response.status >= 200 && response.status < 300) {
    return;
  }
  setupFailureRate.add(1);
  const status = response ? response.status : 'no-response';
  const body = response ? response.body : '';
  throw new Error(`Failed to ${action}. HTTP ${status}: ${body}`);
}

function parseJson(raw) {
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function durationToMs(value) {
  const match = String(value).trim().match(/^(\d+)(ms|s|m|h)$/);
  if (!match) {
    return 10 * 60 * 1000;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === 'ms') {
    return amount;
  }
  if (unit === 's') {
    return amount * 1000;
  }
  if (unit === 'm') {
    return amount * 60 * 1000;
  }
  return amount * 60 * 60 * 1000;
}

function metricValue(data, name, key) {
  const metric = data.metrics[name];
  if (!metric || !metric.values) {
    return null;
  }
  return metric.values[key] === undefined ? null : metric.values[key];
}

function markdownSummary(data, manifest) {
  const lines = [];
  lines.push(`# CommanderZone Load Test ${manifest.phase}`);
  lines.push('');
  lines.push(`- Run: ${manifest.runId}`);
  lines.push(`- API: ${manifest.apiBaseUrl}`);
  lines.push(`- Users: ${manifest.activeUsers}`);
  lines.push(`- Games: ${manifest.games.length}`);
  lines.push(`- Duration: ${manifest.duration}`);
  lines.push(`- Dry run: ${manifest.dryRun ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Key Metrics');
  lines.push('');
  lines.push(`- HTTP failed rate: ${formatMetric(metricValue(data, 'http_req_failed', 'rate'))}`);
  lines.push(`- HTTP p95: ${formatMetric(metricValue(data, 'http_req_duration', 'p(95)'))} ms`);
  lines.push(`- HTTP p99: ${formatMetric(metricValue(data, 'http_req_duration', 'p(99)'))} ms`);
  lines.push(`- WS connect p95: ${formatMetric(metricValue(data, 'cz_ws_connect_ms', 'p(95)'))} ms`);
  lines.push(`- WS command ack p95: ${formatMetric(metricValue(data, 'cz_ws_command_ack_ms', 'p(95)'))} ms`);
  lines.push(`- WS command ack p99: ${formatMetric(metricValue(data, 'cz_ws_command_ack_ms', 'p(99)'))} ms`);
  lines.push(`- WS command error rate: ${formatMetric(metricValue(data, 'cz_ws_command_error_rate', 'rate'))}`);
  lines.push(`- WS command resync rate: ${formatMetric(metricValue(data, 'cz_ws_command_resync_rate', 'rate'))}`);
  lines.push(`- Commands sent: ${formatMetric(metricValue(data, 'cz_ws_commands_sent', 'count'))}`);
  lines.push(`- Sockets opened: ${formatMetric(metricValue(data, 'cz_ws_sockets_opened', 'count'))}`);
  lines.push('');
  lines.push('## Thresholds');
  lines.push('');
  for (const [metricName, metric] of Object.entries(data.metrics || {})) {
    if (!metric.thresholds) {
      continue;
    }
    for (const [thresholdName, threshold] of Object.entries(metric.thresholds)) {
      lines.push(`- ${metricName} ${thresholdName}: ${threshold.ok ? 'pass' : 'fail'}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function formatMetric(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return 'n/a';
  }
  return Number(value).toFixed(4).replace(/\.?0+$/, '');
}
