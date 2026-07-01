import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from './api.config';
import { AuthApi } from './auth.api';
import { ContactApi } from './contact.api';
import { CardsLanguageService } from './cards-language.service';
import { CardsApi } from './cards.api';
import { DeckFormatsApi } from './deck-formats.api';
import { DeckFoldersApi } from './deck-folders.api';
import { DecksApi } from './decks.api';
import { FriendsApi } from './friends.api';
import { GamesApi } from './games.api';
import { LandingApi } from './landing.api';
import { RoomsApi } from './rooms.api';
import { ThemesService } from './themes.service';
import { GLOBAL_LOADING_ENABLED_FEATURES, SKIP_GLOBAL_LOADING } from '../loading/loading-context';
import { TableAssistantApi } from '../../features/table-assistant/data-access/table-assistant.api';
import { LanguagePreferencesService } from '../localization/language-preferences.service';

describe('API services', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: LanguagePreferencesService,
          useValue: {
            cardLanguage: signal<'en' | 'fr' | 'de' | 'it' | 'es' | 'ja' | 'zhs' | 'pt' | 'ru' | 'nl' | 'ca'>('en').asReadonly(),
          } satisfies Pick<LanguagePreferencesService, 'cardLanguage'>,
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('builds card search requests with query params', () => {
    TestBed.inject(CardsApi).search('sol ring').subscribe();

    const request = http.expectOne(`${API_BASE_URL}/cards/search?q=sol%20ring&page=1&limit=500&lang=en`);
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(GLOBAL_LOADING_ENABLED_FEATURES)).toEqual(['cards']);
    request.flush({ data: [], page: 1, limit: 24 });
  });

  it('loads card language coverage with the default global loading policy', () => {
    TestBed.inject(CardsLanguageService).list().subscribe();

    const request = http.expectOne(`${API_BASE_URL}/cards/languages`);
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(false);
    request.flush({ selectedCardLanguage: 'en', data: [] });
  });

  it('loads and updates theme preference with the default global loading policy', () => {
    const themes = TestBed.inject(ThemesService);

    themes.get().subscribe();
    const getRequest = http.expectOne(`${API_BASE_URL}/themes`);
    expect(getRequest.request.method).toBe('GET');
    expect(getRequest.request.context.get(SKIP_GLOBAL_LOADING)).toBe(false);
    getRequest.flush({ themeId: 'sunrise' });

    themes.update('candy-summoners').subscribe();
    const putRequest = http.expectOne(`${API_BASE_URL}/themes`);
    expect(putRequest.request.method).toBe('PUT');
    expect(putRequest.request.body).toEqual({ themeId: 'candy-summoners' });
    expect(putRequest.request.context.get(SKIP_GLOBAL_LOADING)).toBe(false);
    putRequest.flush({ themeId: 'candy-summoners' });
  });

  it('loads public landing preview data with feature-owned loading policy', () => {
    TestBed.inject(LandingApi).preview().subscribe();

    const request = http.expectOne(`${API_BASE_URL}/landing/preview`);
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(false);
    request.flush({ cardName: 'Sol Ring', displayName: 'Player' });
  });

  it('posts contact requests through the public contact endpoint', () => {
    TestBed.inject(ContactApi).send({
      name: 'Player One',
      email: 'player@example.test',
      subject: 'Bug report',
      message: 'Something went wrong.',
    }).subscribe();

    const request = http.expectOne(`${API_BASE_URL}/contact`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      name: 'Player One',
      email: 'player@example.test',
      subject: 'Bug report',
      message: 'Something went wrong.',
    });
    request.flush({ accepted: true });
  });

  it('loads table assistant rooms with feature-owned loading policy', () => {
    TestBed.inject(TableAssistantApi).get('room-1').subscribe();

    const request = http.expectOne(`${API_BASE_URL}/table-assistant/rooms/room-1`);
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(false);
    request.flush({ tableAssistantRoom: {} });
  });

  it('marks the current user offline without triggering the global loading overlay', () => {
    TestBed.inject(AuthApi).offline().subscribe();

    const request = http.expectOne(`${API_BASE_URL}/me/offline`);
    expect(request.request.method).toBe('POST');
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(true);
    request.flush(null);
  });

  it('updates and deletes authenticated profile through /me endpoints', () => {
    const auth = TestBed.inject(AuthApi);

    auth.updateMe({
      email: 'updated@example.test',
      displayName: 'Updated Player',
      gamePreferences: { enableManaRow: false },
    }).subscribe();
    let request = http.expectOne(`${API_BASE_URL}/me`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({
      email: 'updated@example.test',
      displayName: 'Updated Player',
      gamePreferences: { enableManaRow: false },
    });
    request.flush({ user: { id: 'user-1', email: 'updated@example.test', displayName: 'Updated Player', roles: ['ROLE_USER'] } });

    auth.updateAvatar({ type: 'preset', imageUrl: 'assets/images/avatars/storm-seer.png' }).subscribe();
    request = http.expectOne(`${API_BASE_URL}/me/avatar`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ type: 'preset', imageUrl: 'assets/images/avatars/storm-seer.png' });
    request.flush({
      user: {
        id: 'user-1',
        email: 'updated@example.test',
        displayName: 'Updated Player',
        roles: ['ROLE_USER'],
        avatar: { type: 'preset', imageUrl: 'assets/images/avatars/storm-seer.png' },
      },
    });

    auth.updateDisplayNameStyle({ presetId: 'obsidian-crown', textColor: '#ffeeaa' }).subscribe();
    request = http.expectOne(`${API_BASE_URL}/me/display-name-style`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ presetId: 'obsidian-crown', textColor: '#ffeeaa' });
    request.flush({
      user: {
        id: 'user-1',
        email: 'updated@example.test',
        displayName: 'Updated Player',
        roles: ['ROLE_USER'],
        displayNameStyle: { type: 'preset', presetId: 'obsidian-crown', textColor: '#ffeeaa' },
      },
    });

    auth.deleteMe().subscribe();
    request = http.expectOne(`${API_BASE_URL}/me`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null);
  });

  it('requests and confirms password reset with feature-owned loading policy', () => {
    const auth = TestBed.inject(AuthApi);

    auth.requestPasswordReset('player@example.test').subscribe();
    let request = http.expectOne(`${API_BASE_URL}/auth/password-reset/request`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'player@example.test' });
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(false);
    request.flush({ accepted: true });

    auth.confirmPasswordReset({ email: 'player@example.test', token: 'reset-token', newPassword: 'Password456!' }).subscribe();
    request = http.expectOne(`${API_BASE_URL}/auth/password-reset/confirm`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ email: 'player@example.test', token: 'reset-token', newPassword: 'Password456!' });
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(false);
    expect(request.request.withCredentials).toBe(true);
    request.flush({ updated: true, token: 'jwt-token' });
  });

  it('confirms email verification with feature-owned loading policy', () => {
    const auth = TestBed.inject(AuthApi);

    auth.confirmEmailVerification({ token: 'verify-token' }).subscribe();
    const request = http.expectOne(`${API_BASE_URL}/auth/email-verification/confirm`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ token: 'verify-token' });
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(false);
    expect(request.request.withCredentials).toBe(true);
    request.flush({ verified: true, token: 'jwt-token', user: { id: 'user-1', email: 'player@example.test', roles: ['ROLE_USER'] } });
  });

  it('refreshes and revokes auth session with credentials', () => {
    const auth = TestBed.inject(AuthApi);

    auth.refresh().subscribe();
    let request = http.expectOne(`${API_BASE_URL}/auth/refresh`);
    expect(request.request.method).toBe('POST');
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(true);
    expect(request.request.withCredentials).toBe(true);
    request.flush({ token: 'jwt-token' });

    auth.logout().subscribe();
    request = http.expectOne(`${API_BASE_URL}/auth/logout`);
    expect(request.request.method).toBe('POST');
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(true);
    expect(request.request.withCredentials).toBe(true);
    request.flush(null);
  });

  it('builds filtered card search requests', () => {
    TestBed.inject(CardsApi).search('atraxa', 1, 8, {
      commanderLegal: true,
      commanderCandidate: true,
      tokenOnly: true,
      basic: true,
      legendary: true,
      sort: 'mana_value_desc',
    }).subscribe();

    const request = http.expectOne(`${API_BASE_URL}/cards/search?q=atraxa&page=1&limit=8&lang=en&commanderLegal=true&commanderCandidate=true&sort=mana_value_desc&basic=true&legendary=true&tokenOnly=true`);
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(GLOBAL_LOADING_ENABLED_FEATURES)).toEqual(['cards']);
    request.flush({ data: [], page: 1, limit: 8 });
  });

  it('serializes the colors sort for card search requests', () => {
    TestBed.inject(CardsApi).search('atraxa', 1, 8, {
      sort: 'colors',
    }).subscribe();

    const request = http.expectOne(`${API_BASE_URL}/cards/search?q=atraxa&page=1&limit=8&lang=en&sort=colors`);
    expect(request.request.method).toBe('GET');
    request.flush({ data: [], page: 1, limit: 8 });
  });

  it('requests card search options with the preferred card language', () => {
    TestBed.inject(CardsApi).searchOptions().subscribe();

    const request = http.expectOne(`${API_BASE_URL}/cards/search/options?lang=en`);
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(GLOBAL_LOADING_ENABLED_FEATURES)).toEqual(['cards']);
    request.flush({ types: [], subtypes: [], sets: [], rarities: [], formats: [] });
  });

  it('adds gameplayKind to card search requests without changing tokenOnly behavior', () => {
    TestBed.inject(CardsApi).search('ring', 1, 12, { gameplayKind: 'emblem' }).subscribe();

    const request = http.expectOne(`${API_BASE_URL}/cards/search?q=ring&page=1&limit=12&lang=en&gameplayKind=emblem`);
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(GLOBAL_LOADING_ENABLED_FEATURES)).toEqual(['cards']);
    request.flush({ data: [], page: 1, limit: 12 });
  });

  it('requests card image URIs from the backend image endpoint', () => {
    TestBed.inject(CardsApi).image('card-1', 'normal').subscribe();

    const request = http.expectOne(`${API_BASE_URL}/cards/card-1/image?format=normal&mode=uri`);
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(GLOBAL_LOADING_ENABLED_FEATURES)).toEqual(['cards']);
    request.flush({ scryfallId: 'card-1', format: 'normal', uri: 'http://image.test/card-1.jpg' });
  });

  it('requests card detail with the preferred language query parameter', () => {
    TestBed.inject(CardsApi).get('card-1').subscribe();

    const request = http.expectOne(`${API_BASE_URL}/cards/card-1?lang=en`);
    expect(request.request.method).toBe('GET');
    request.flush({ card: { id: 'card-1', scryfallId: 'card-1', name: 'Sol Ring' } });
  });

  it('requests card print editions with the preferred language query parameter', () => {
    TestBed.inject(CardsApi).printings('card-1').subscribe();

    const request = http.expectOne(`${API_BASE_URL}/cards/card-1/printings?lang=en`);
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(GLOBAL_LOADING_ENABLED_FEATURES)).toEqual(['cards']);
    request.flush({ scryfallId: 'card-1', data: [] });
  });

  it('posts deck imports with the backend payload shape', () => {
    TestBed.inject(DecksApi).importDecklist('deck-1', '1 Sol Ring').subscribe();

    const request = http.expectOne(`${API_BASE_URL}/decks/deck-1/import`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ decklist: '1 Sol Ring' });
    request.flush({ deck: { id: 'deck-1', name: 'Deck', format: 'commander', folderId: null, cards: [] }, missing: [] });
  });

  it('posts deck imports with explicit selected commander ids when provided', () => {
    TestBed.inject(DecksApi).importDecklist('deck-1', 'Deck\n1 Derevi, Empyrial Tactician\n99 Island', {
      commanderScryfallIds: ['7b1817d5-11f6-486a-a937-f15e5d8dd2a6'],
    }).subscribe();

    const request = http.expectOne(`${API_BASE_URL}/decks/deck-1/import`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      decklist: 'Deck\n1 Derevi, Empyrial Tactician\n99 Island',
      commanderScryfallIds: ['7b1817d5-11f6-486a-a937-f15e5d8dd2a6'],
    });
    request.flush({ deck: { id: 'deck-1', name: 'Deck', format: 'commander', folderId: null, cards: [] }, missing: [] });
  });

  it('creates decks with the backend folder payload shape', () => {
    TestBed.inject(DecksApi).create('Deck', 'folder-1', 'private', 'commander').subscribe();

    const request = http.expectOne(`${API_BASE_URL}/decks`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Deck', folderId: 'folder-1', visibility: 'private', format: 'commander' });
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

    it('supports selecting deck card print versions', () => {
      const decks = TestBed.inject(DecksApi);

      decks.printings('deck-1', 'line-1').subscribe();
      let request = http.expectOne(`${API_BASE_URL}/decks/deck-1/cards/line-1/printings`);
      expect(request.request.method).toBe('GET');
      request.flush({ deckCardId: 'line-1', data: [] });

      decks.selectPrinting('deck-1', 'line-1', 'card-print-2').subscribe();
      request = http.expectOne(`${API_BASE_URL}/decks/deck-1/cards/line-1/printing`);
      expect(request.request.method).toBe('PATCH');
      expect(request.request.body).toEqual({ scryfallId: 'card-print-2' });
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
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(true);
    request.flush({ data: [] });

    friends.requestUser('user-2').subscribe();
    request = http.expectOne(`${API_BASE_URL}/friends/requests`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ userId: 'user-2' });
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(false);
    request.flush({ friendship: friendshipFixture('friendship-1') });

    friends.incoming().subscribe();
    request = http.expectOne(`${API_BASE_URL}/friends/requests/incoming`);
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(true);
    request.flush({ data: [] });

    friends.outgoing().subscribe();
    request = http.expectOne(`${API_BASE_URL}/friends/requests/outgoing`);
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(true);
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
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(true);
    request.flush({ data: [] });

    friends.remove('user-2').subscribe();
    request = http.expectOne(`${API_BASE_URL}/friends/user-2`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null);
  });

  it('posts game commands with feature-owned loading policy', () => {
    TestBed.inject(GamesApi)
      .command({ type: 'life.changed', payload: { playerId: 'p1', delta: -1 } }, 'game-1')
      .subscribe();

    const request = http.expectOne(`${API_BASE_URL}/games/game-1/commands`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ type: 'life.changed', payload: { playerId: 'p1', delta: -1 } });
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(false);
    request.flush({ event: {}, snapshot: { players: {}, turn: { activePlayerId: null, phase: 'beginning', number: 1 }, chat: [], createdAt: '' } });
  });

  it('requests gameplay websocket tickets with feature-owned loading policy', () => {
    TestBed.inject(GamesApi).websocketTicket('game-1').subscribe();

    const request = http.expectOne(`${API_BASE_URL}/games/game-1/websocket-ticket`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(false);
    request.flush({
      ticket: 'ticket-1',
      expiresAt: '2026-01-01T00:00:30+00:00',
      websocketUrl: 'ws://127.0.0.1:8091/ws?ticket=ticket-1',
      route: 'runtime_ws',
    });
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

    rooms.update('room-1', { maxPlayers: 3 }).subscribe();
    request = http.expectOne(`${API_BASE_URL}/rooms/room-1`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ maxPlayers: 3 });
    request.flush({ room: roomFixture('room-1') });

    rooms.rollTurn('room-1').subscribe();
    request = http.expectOne(`${API_BASE_URL}/rooms/room-1/roll-turn`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    request.flush({ room: roomFixture('room-1') });

    rooms.joinByCode('CZ-ABC-DEF-123', undefined, true).subscribe();
    request = http.expectOne(`${API_BASE_URL}/rooms/code/CZ-ABC-DEF-123/join`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(false);
    request.flush({ room: roomFixture('room-1') });

    rooms.kickPlayer('room-1', 'player-1', true).subscribe();
    request = http.expectOne(`${API_BASE_URL}/rooms/room-1/players/player-1`);
    expect(request.request.method).toBe('DELETE');
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(false);
    request.flush({ room: roomFixture('room-1') });

    rooms.update('room-1', { startingLife: 45 }, true).subscribe();
    request = http.expectOne(`${API_BASE_URL}/rooms/room-1`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ startingLife: 45 });
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(false);
    request.flush({ room: roomFixture('room-1') });

    rooms.update('room-1', { timerMode: 'turn', timerDurationSeconds: 120 }, true).subscribe();
    request = http.expectOne(`${API_BASE_URL}/rooms/room-1`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ timerMode: 'turn', timerDurationSeconds: 120 });
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(false);
    request.flush({ room: roomFixture('room-1') });

    rooms.update('room-1', { mulliganRule: 'GENEROUS', firstMulliganFree: false }, true).subscribe();
    request = http.expectOne(`${API_BASE_URL}/rooms/room-1`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ mulliganRule: 'GENEROUS', firstMulliganFree: false });
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(false);
    request.flush({ room: roomFixture('room-1') });

    rooms.list('active', true).subscribe();
    request = http.expectOne(`${API_BASE_URL}/rooms?status=active`);
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(false);
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
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(false);
    request.flush({ data: [] });

    rooms.invites('room-1', true).subscribe();
    request = http.expectOne(`${API_BASE_URL}/rooms/room-1/invites`);
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(false);
    request.flush({ data: [] });
  });

  it('loads room detail and accepts room invites with a deck id', () => {
    const rooms = TestBed.inject(RoomsApi);

    rooms.show('room-1').subscribe();
    let request = http.expectOne(`${API_BASE_URL}/rooms/room-1`);
    expect(request.request.method).toBe('GET');
    request.flush({ room: roomFixture('room-1') });

    rooms.show('room-1', true).subscribe();
    request = http.expectOne(`${API_BASE_URL}/rooms/room-1`);
    expect(request.request.method).toBe('GET');
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(false);
    request.flush({ room: roomFixture('room-1') });

    rooms.acceptInvite('invite-1', 'deck-1').subscribe();
    request = http.expectOne(`${API_BASE_URL}/rooms/invites/invite-1/accept`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ deckId: 'deck-1' });
    request.flush({ invite: {}, room: roomFixture('room-1') });
  });

  it('sends random deck metadata when joining a room from random selection', () => {
    const rooms = TestBed.inject(RoomsApi);

    rooms.join('room-1', 'deck-1', true, { randomDeckOptionCount: 4 }).subscribe();
    const request = http.expectOne(`${API_BASE_URL}/rooms/room-1/join`);

    expect(request.request.method).toBe('POST');
    expect(request.request.context.get(SKIP_GLOBAL_LOADING)).toBe(false);
    expect(request.request.body).toEqual({ deckId: 'deck-1', randomDeckOptionCount: 4 });
    request.flush({ room: roomFixture('room-1') });
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
    name: 'Mesa de Owner',
    status: 'waiting',
    visibility: 'private',
    format: 'commander',
    maxPlayers: 4,
    startingLife: 40,
    timerMode: 'none',
    timerDurationSeconds: 300,
    mulliganRule: 'LONDON',
    firstMulliganFree: true,
    owner: { id: 'user-1', email: 'owner@example.test', displayName: 'Owner', roles: [] },
    players: [],
    gameId: null,
  };
}
