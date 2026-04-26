import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from './api.config';
import { CardsApi } from './cards.api';
import { DeckFormatsApi } from './deck-formats.api';
import { DeckFoldersApi } from './deck-folders.api';
import { DecksApi } from './decks.api';
import { GamesApi } from './games.api';
import { SKIP_GLOBAL_LOADING } from '../loading/loading-context';

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

  it('builds filtered card search requests', () => {
    TestBed.inject(CardsApi).search('atraxa', 1, 8, { commanderLegal: true }).subscribe();

    const request = http.expectOne(`${API_BASE_URL}/cards/search?q=atraxa&page=1&limit=8&commanderLegal=true`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: [], page: 1, limit: 8 });
  });

  it('requests card image URIs from the backend image endpoint', () => {
    TestBed.inject(CardsApi).image('card-1', 'normal').subscribe();

    const request = http.expectOne(`${API_BASE_URL}/cards/card-1/image?format=normal&mode=uri`);
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(true);
    request.flush({ scryfallId: 'card-1', format: 'normal', uri: 'http://image.test/card-1.jpg' });
  });

  it('posts deck imports with the backend payload shape', () => {
    TestBed.inject(DecksApi).importDecklist('deck-1', '1 Sol Ring').subscribe();

    const request = http.expectOne(`${API_BASE_URL}/decks/deck-1/import`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ decklist: '1 Sol Ring' });
    request.flush({ deck: { id: 'deck-1', name: 'Deck', format: 'commander', folderId: null, cards: [] }, missing: [] });
  });

  it('creates decks with the backend folder payload shape', () => {
    TestBed.inject(DecksApi).create('Deck', 'folder-1').subscribe();

    const request = http.expectOne(`${API_BASE_URL}/decks`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Deck', folderId: 'folder-1' });
    request.flush({ deck: { id: 'deck-1', name: 'Deck', format: 'commander', folderId: 'folder-1', cards: [] } });
  });

  it('adds cards through the deck card mutation endpoint', () => {
    TestBed.inject(DecksApi).addCard('deck-1', { scryfallId: 'card-1', quantity: 2, section: 'main' }).subscribe();

    const request = http.expectOne(`${API_BASE_URL}/decks/deck-1/cards`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ scryfallId: 'card-1', quantity: 2, section: 'main' });
    request.flush({ deck: { id: 'deck-1', name: 'Deck', format: 'commander', folderId: null, cards: [] } });
  });

  it('lists deck folders through the backend endpoint', () => {
    TestBed.inject(DeckFoldersApi).list().subscribe();

    const request = http.expectOne(`${API_BASE_URL}/deck-folders`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: [] });
  });

  it('lists deck folder names through the lightweight endpoint', () => {
    TestBed.inject(DeckFoldersApi).names().subscribe();

    const request = http.expectOne(`${API_BASE_URL}/deck-folders/names`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: [] });
  });

  it('lists deck formats through the backend endpoint', () => {
    TestBed.inject(DeckFormatsApi).list().subscribe();

    const request = http.expectOne(`${API_BASE_URL}/deck-formats`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: [{ id: 'commander', name: 'Commander', minCards: 100, maxCards: 100, hasCommander: true }] });
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
