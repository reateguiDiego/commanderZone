import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from './api.config';
import { AuthApi } from './auth.api';
import { CardsApi } from './cards.api';
import { DeckFormatsApi } from './deck-formats.api';
import { DeckFoldersApi } from './deck-folders.api';
import { DecksApi } from './decks.api';
import { FriendsApi } from './friends.api';
import { GamesApi } from './games.api';
import { RoomsApi } from './rooms.api';
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

  it('marks the current user offline without triggering the global loading overlay', () => {
    TestBed.inject(AuthApi).offline().subscribe();

    const request = http.expectOne(`${API_BASE_URL}/me/offline`);
    expect(request.request.method).toBe('POST');
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(true);
    request.flush(null);
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
    expect(request.request.body).toEqual({ name: 'Deck', folderId: 'folder-1', visibility: 'private' });
    request.flush({ deck: { id: 'deck-1', name: 'Deck', format: 'commander', folderId: 'folder-1', cards: [] } });
  });

  it('moves decks between folders without triggering the global loading overlay', () => {
    TestBed.inject(DecksApi).moveToFolder('deck-1', 'folder-1').subscribe();

    const request = http.expectOne(`${API_BASE_URL}/decks/deck-1`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ folderId: 'folder-1' });
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(true);
    request.flush({ deck: { id: 'deck-1', name: 'Deck', format: 'commander', folderId: 'folder-1', cards: [] } });
  });

  it('loads backend deck analysis through the analysis endpoint', () => {
    TestBed.inject(DecksApi).analysis('deck-1', { includeSideboard: true, curvePlayabilityMode: 'draw' }).subscribe();

    const request = http.expectOne(`${API_BASE_URL}/decks/deck-1/analysis?includeSideboard=true&curvePlayabilityMode=draw`);
    expect(request.request.method).toBe('GET');
    request.flush(deckAnalysisFixture());
  });

  it('adds cards through the deck card mutation endpoint', () => {
    TestBed.inject(DecksApi).addCard('deck-1', { setCode: 'tst', collectorNumber: '1', quantity: 2, section: 'main' }).subscribe();

    const request = http.expectOne(`${API_BASE_URL}/decks/deck-1/cards`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ setCode: 'tst', collectorNumber: '1', quantity: 2, section: 'main' });
    request.flush({ deck: { id: 'deck-1', name: 'Deck', format: 'commander', folderId: null, cards: [] } });
  });

  it('supports quick build, batch card updates, and commander replacement', () => {
    const decks = TestBed.inject(DecksApi);
    decks.quickBuild({ name: 'Deck', cards: [{ name: 'Sol Ring' }] }).subscribe();
    let request = http.expectOne(`${API_BASE_URL}/decks/quick-build`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Deck', cards: [{ name: 'Sol Ring' }] });
    request.flush({ deck: { id: 'deck-1', name: 'Deck', format: 'commander', folderId: null, cards: [] }, missing: [] });

    decks.updateCards('deck-1', [{ deckCardId: 'line-1', quantity: 0 }]).subscribe();
    request = http.expectOne(`${API_BASE_URL}/decks/deck-1/cards`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ cards: [{ deckCardId: 'line-1', quantity: 0 }] });
    request.flush({ deck: { id: 'deck-1', name: 'Deck', format: 'commander', folderId: null, cards: [] } });

    decks.replaceCommanders('deck-1', [{ deckCardId: 'line-2' }]).subscribe();
    request = http.expectOne(`${API_BASE_URL}/decks/deck-1/commanders`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ cards: [{ deckCardId: 'line-2' }] });
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

  it('supports friendship endpoints', () => {
    const friends = TestBed.inject(FriendsApi);

    friends.search('bo').subscribe();
    let request = http.expectOne(`${API_BASE_URL}/friends/search?q=bo`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: [] });

    friends.request('bob@example.test').subscribe();
    request = http.expectOne(`${API_BASE_URL}/friends/requests`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'bob@example.test' });
    request.flush({ friendship: friendshipFixture('friendship-1') });

    friends.requestUser('user-2').subscribe();
    request = http.expectOne(`${API_BASE_URL}/friends/requests`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ userId: 'user-2' });
    request.flush({ friendship: friendshipFixture('friendship-1') });

    friends.incoming().subscribe();
    request = http.expectOne(`${API_BASE_URL}/friends/requests/incoming`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: [] });

    friends.outgoing().subscribe();
    request = http.expectOne(`${API_BASE_URL}/friends/requests/outgoing`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: [] });

    friends.accept('friendship-1').subscribe();
    request = http.expectOne(`${API_BASE_URL}/friends/requests/friendship-1/accept`);
    expect(request.request.method).toBe('POST');
    request.flush({ friendship: friendshipFixture('friendship-1', 'accepted') });

    friends.decline('friendship-2').subscribe();
    request = http.expectOne(`${API_BASE_URL}/friends/requests/friendship-2/decline`);
    expect(request.request.method).toBe('POST');
    request.flush(null);

    friends.cancel('friendship-3').subscribe();
    request = http.expectOne(`${API_BASE_URL}/friends/requests/friendship-3`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null);

    friends.list().subscribe();
    request = http.expectOne(`${API_BASE_URL}/friends`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: [] });

    friends.remove('user-2').subscribe();
    request = http.expectOne(`${API_BASE_URL}/friends/user-2`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null);
  });

  it('posts game commands with type and payload', () => {
    TestBed.inject(GamesApi)
      .command({ type: 'life.changed', payload: { playerId: 'p1', delta: -1 } }, 'game-1')
      .subscribe();

    const request = http.expectOne(`${API_BASE_URL}/games/game-1/commands`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ type: 'life.changed', payload: { playerId: 'p1', delta: -1 } });
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(true);
    request.flush({ event: {}, snapshot: { players: {}, turn: { activePlayerId: null, phase: 'beginning', number: 1 }, chat: [], createdAt: '' } });
  });

  it('deletes rooms through the room endpoint', () => {
    const rooms = TestBed.inject(RoomsApi);

    rooms.list().subscribe();
    let request = http.expectOne(`${API_BASE_URL}/rooms?status=active`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: [] });

    rooms.delete('room-1').subscribe();

    request = http.expectOne(`${API_BASE_URL}/rooms/room-1`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null);

    rooms.archive('room-1').subscribe();
    request = http.expectOne(`${API_BASE_URL}/rooms/room-1/archive`);
    expect(request.request.method).toBe('POST');
    request.flush({ room: roomFixture('room-1') });

    rooms.list('active', true).subscribe();
    request = http.expectOne(`${API_BASE_URL}/rooms?status=active`);
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(true);
    request.flush({ data: [] });
  });

  it('handles room invites through existing room endpoints', () => {
    const rooms = TestBed.inject(RoomsApi);

    rooms.incomingInvites().subscribe();
    let request = http.expectOne(`${API_BASE_URL}/rooms/invites/incoming`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: [] });

    rooms.acceptInvite('invite-1').subscribe();
    request = http.expectOne(`${API_BASE_URL}/rooms/invites/invite-1/accept`);
    expect(request.request.method).toBe('POST');
    request.flush({ invite: {} });

    rooms.declineInvite('invite-2').subscribe();
    request = http.expectOne(`${API_BASE_URL}/rooms/invites/invite-2/decline`);
    expect(request.request.method).toBe('POST');
    request.flush({ invite: {} });

    rooms.invites('room-1').subscribe();
    request = http.expectOne(`${API_BASE_URL}/rooms/room-1/invites`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: [] });

    rooms.incomingInvites(true).subscribe();
    request = http.expectOne(`${API_BASE_URL}/rooms/invites/incoming`);
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(true);
    request.flush({ data: [] });

    rooms.invites('room-1', true).subscribe();
    request = http.expectOne(`${API_BASE_URL}/rooms/room-1/invites`);
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(true);
    request.flush({ data: [] });
  });

  it('loads room detail and accepts room invites with a deck id', () => {
    const rooms = TestBed.inject(RoomsApi);

    rooms.show('room-1').subscribe();
    let request = http.expectOne(`${API_BASE_URL}/rooms/room-1`);
    expect(request.request.method).toBe('GET');
    request.flush({ room: roomFixture('room-1') });

    rooms.acceptInvite('invite-1', 'deck-1').subscribe();
    request = http.expectOne(`${API_BASE_URL}/rooms/invites/invite-1/accept`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ deckId: 'deck-1' });
    request.flush({ invite: {}, room: roomFixture('room-1') });
  });
});


function deckAnalysisFixture() {
  const colors = ['W', 'U', 'B', 'R', 'G', 'C'];

  return {
    summary: {
      totalCards: 0,
      mainboardCards: 0,
      commanderCards: 0,
      landCount: 0,
      nonLandCount: 0,
      creatureCount: 0,
      instantCount: 0,
      sorceryCount: 0,
      artifactCount: 0,
      enchantmentCount: 0,
      planeswalkerCount: 0,
      battleCount: 0,
      averageManaValueWithLands: 0,
      averageManaValueWithoutLands: 0,
      medianManaValueWithLands: 0,
      medianManaValueWithoutLands: 0,
      totalManaValue: 0,
      colorIdentity: [],
    },
    manaCurve: { buckets: [] },
    typeBreakdown: { sections: [] },
    colorRequirement: {
      totalColoredSymbols: 0,
      totalAllSymbols: 0,
      estimated: false,
      symbolsByColor: Object.fromEntries(colors.map((color) => [color, { color, symbolCount: 0, percentageOfColoredSymbols: 0, percentageOfAllSymbols: 0, cardsRequiringColor: 0 }])),
    },
    manaProduction: {
      totalManaSources: 0,
      totalProducedSymbols: 0,
      estimated: false,
      productionByColor: Object.fromEntries(colors.map((color) => [color, { color, sourceCount: 0, symbolCount: 0, percentageOfAllProduction: 0, percentageFromLands: 0, landSourceCount: 0, nonLandSourceCount: 0 }])),
    },
    colorBalance: { colors: [] },
    curvePlayability: { disclaimer: '', buckets: [] },
    sections: [],
    options: {
      includeCommanderInAnalysis: true,
      includeSideboard: false,
      includeMaybeboard: false,
      curvePlayabilityMode: 'play',
      manaSourcesMode: 'landsOnly',
    },
  };
}

function friendshipFixture(id: string, status = 'pending') {
  return {
    id,
    status,
    requester: { id: 'user-1', displayName: 'Alice' },
    recipient: { id: 'user-2', displayName: 'Bob' },
    friend: { id: 'user-2', displayName: 'Bob', presence: 'offline' },
    createdAt: '2026-04-29T00:00:00+00:00',
    updatedAt: '2026-04-29T00:00:00+00:00',
  };
}

function roomFixture(id: string) {
  return {
    id,
    status: 'waiting',
    visibility: 'private',
    owner: { id: 'user-1', email: 'owner@example.test', displayName: 'Owner', roles: [] },
    players: [],
    gameId: null,
  };
}
