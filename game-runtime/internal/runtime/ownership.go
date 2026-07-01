package runtime

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"commanderzone/game-runtime/internal/persistence"
)

var ErrOwnershipNotHeld = persistence.ErrOwnershipNotHeld

type OwnershipLease struct {
	GameID    string
	OwnerID   string
	Token     uint64
	ExpiresAt time.Time
}

type OwnershipAcquireResult struct {
	Lease      OwnershipLease
	Reacquired bool
	Renewed    bool
	Stolen     bool
	Expired    bool
}

type OwnershipManager interface {
	Mode() string
	Acquire(ctx context.Context, gameID string, ownerID string) (OwnershipAcquireResult, error)
	EnsureHeld(ctx context.Context, lease OwnershipLease) error
	Renew(ctx context.Context, lease OwnershipLease) (OwnershipLease, error)
	Release(ctx context.Context, lease OwnershipLease) error
}

type InMemoryOwnershipManager struct {
	mu        sync.Mutex
	leases    map[string]OwnershipLease
	ttl       time.Duration
	now       func() time.Time
	nextToken uint64
	mode      string
}

func NewSingleNodeOwnershipManager() *InMemoryOwnershipManager {
	return NewInMemoryOwnershipManager("single-node", 0)
}

func NewInMemoryOwnershipManager(mode string, ttl time.Duration) *InMemoryOwnershipManager {
	mode = strings.TrimSpace(mode)
	if mode == "" {
		mode = "single-node"
	}
	return &InMemoryOwnershipManager{
		leases: map[string]OwnershipLease{},
		ttl:    ttl,
		now:    func() time.Time { return time.Now().UTC() },
		mode:   mode,
	}
}

func (m *InMemoryOwnershipManager) Mode() string {
	return m.mode
}

func (m *InMemoryOwnershipManager) Acquire(_ context.Context, gameID string, ownerID string) (OwnershipAcquireResult, error) {
	gameID = strings.TrimSpace(gameID)
	ownerID = strings.TrimSpace(ownerID)
	if gameID == "" {
		return OwnershipAcquireResult{}, fmt.Errorf("%w: gameId is required", ErrOwnershipNotHeld)
	}
	if ownerID == "" {
		return OwnershipAcquireResult{}, fmt.Errorf("%w: ownerId is required", ErrOwnershipNotHeld)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	now := m.now()
	existing, ok := m.leases[gameID]
	if ok && existing.OwnerID == ownerID && !m.expiredLocked(existing, now) {
		if m.ttl > 0 {
			existing.ExpiresAt = now.Add(m.ttl)
			m.leases[gameID] = existing
		}
		return OwnershipAcquireResult{Lease: existing, Reacquired: true, Renewed: m.ttl > 0}, nil
	}
	if ok && existing.OwnerID != ownerID && !m.expiredLocked(existing, now) {
		return OwnershipAcquireResult{}, fmt.Errorf("%w: game %s is owned by %s", ErrOwnershipNotHeld, gameID, existing.OwnerID)
	}

	m.nextToken++
	lease := OwnershipLease{
		GameID:  gameID,
		OwnerID: ownerID,
		Token:   m.nextToken,
	}
	if m.ttl > 0 {
		lease.ExpiresAt = now.Add(m.ttl)
	}
	m.leases[gameID] = lease
	return OwnershipAcquireResult{
		Lease:   lease,
		Stolen:  ok && existing.OwnerID != ownerID,
		Expired: ok && m.expiredLocked(existing, now),
	}, nil
}

func (m *InMemoryOwnershipManager) EnsureHeld(_ context.Context, lease OwnershipLease) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	existing, ok := m.leases[lease.GameID]
	if !ok {
		return fmt.Errorf("%w: game %s has no owner", ErrOwnershipNotHeld, lease.GameID)
	}
	if existing.OwnerID != lease.OwnerID || existing.Token != lease.Token {
		return fmt.Errorf("%w: game %s owner token is stale", ErrOwnershipNotHeld, lease.GameID)
	}
	if m.expiredLocked(existing, m.now()) {
		delete(m.leases, lease.GameID)
		return fmt.Errorf("%w: game %s owner token expired", ErrOwnershipNotHeld, lease.GameID)
	}
	return nil
}

func (m *InMemoryOwnershipManager) Renew(_ context.Context, lease OwnershipLease) (OwnershipLease, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	existing, ok := m.leases[lease.GameID]
	if !ok {
		return OwnershipLease{}, fmt.Errorf("%w: game %s has no owner", ErrOwnershipNotHeld, lease.GameID)
	}
	if existing.OwnerID != lease.OwnerID || existing.Token != lease.Token {
		return OwnershipLease{}, fmt.Errorf("%w: game %s owner token is stale", ErrOwnershipNotHeld, lease.GameID)
	}
	now := m.now()
	if m.expiredLocked(existing, now) {
		delete(m.leases, lease.GameID)
		return OwnershipLease{}, fmt.Errorf("%w: game %s owner token expired", ErrOwnershipNotHeld, lease.GameID)
	}
	if m.ttl > 0 {
		existing.ExpiresAt = now.Add(m.ttl)
		m.leases[lease.GameID] = existing
	}
	return existing, nil
}

func (m *InMemoryOwnershipManager) Release(_ context.Context, lease OwnershipLease) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	existing, ok := m.leases[lease.GameID]
	if !ok {
		return nil
	}
	if existing.OwnerID != lease.OwnerID || existing.Token != lease.Token {
		return fmt.Errorf("%w: game %s owner token is stale", ErrOwnershipNotHeld, lease.GameID)
	}
	delete(m.leases, lease.GameID)
	return nil
}

func (m *InMemoryOwnershipManager) expiredLocked(lease OwnershipLease, now time.Time) bool {
	return !lease.ExpiresAt.IsZero() && !now.Before(lease.ExpiresAt)
}

func (m *InMemoryOwnershipManager) forceOwnerForTest(gameID string, ownerID string) OwnershipLease {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.nextToken++
	lease := OwnershipLease{
		GameID:  gameID,
		OwnerID: ownerID,
		Token:   m.nextToken,
	}
	if m.ttl > 0 {
		lease.ExpiresAt = m.now().Add(m.ttl)
	}
	m.leases[gameID] = lease
	return lease
}

func (m *InMemoryOwnershipManager) expireForTest(gameID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	lease, ok := m.leases[gameID]
	if !ok {
		return
	}
	lease.ExpiresAt = m.now().Add(-time.Nanosecond)
	m.leases[gameID] = lease
}

var defaultRuntimeInstanceSequence atomic.Uint64

func DefaultRuntimeInstanceID() string {
	hostname, err := os.Hostname()
	if err != nil || strings.TrimSpace(hostname) == "" {
		hostname = "runtime"
	}
	return fmt.Sprintf("%s-%d-%d", hostname, os.Getpid(), defaultRuntimeInstanceSequence.Add(1))
}
