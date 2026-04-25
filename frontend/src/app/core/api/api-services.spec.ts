import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from './api.config';
import { CardsApi } from './cards.api';
import { DecksApi } from './decks.api';
import { GamesApi } from './games.api';

describe('API services', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('builds card search requests with query params', () => {
    TestBed.inject(CardsApi).search('sol ring').subscribe();

    const request = http.expectOne(`${API_BASE_URL}/cards/search?q=sol%20ring&page=1&limit=24`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: [], page: 1, limit: 24 });
  });

  it('posts deck imports with the backend payload shape', () => {
    TestBed.inject(DecksApi).importDecklist('deck-1', '1 Sol Ring').subscribe();

    const request = http.expectOne(`${API_BASE_URL}/decks/deck-1/import`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ decklist: '1 Sol Ring' });
    request.flush({ deck: { id: 'deck-1', name: 'Deck', format: 'commander', cards: [] }, missing: [] });
  });

  it('posts game commands with type and payload', () => {
    TestBed.inject(GamesApi)
      .command({ type: 'life.changed', payload: { playerId: 'p1', delta: -1 } }, 'game-1')
      .subscribe();

    const request = http.expectOne(`${API_BASE_URL}/games/game-1/commands`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ type: 'life.changed', payload: { playerId: 'p1', delta: -1 } });
    request.flush({ event: {}, snapshot: { players: {}, turn: { activePlayerId: null, phase: 'beginning', number: 1 }, chat: [], createdAt: '' } });
  });
});

