import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Biohazard, ChevronDown, Circle, Crown, Flag, Library, LucideAngularModule, Minus, Plus, Radiation, Sparkles, Tickets, Zap } from 'lucide-angular';
import { GameCardInstance, GameSpecialEntity, GameZoneName } from '../../../../../core/models/game.model';
import { PlayerView } from '../../state/core/game-table-snapshot-selectors';
import {
  PLAYER_SUMMARY_ACTION_DEBOUNCE_MS,
  PlayerSummaryPanelComponent,
} from './player-summary-panel.component';

describe('PlayerSummaryPanelComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlayerSummaryPanelComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ Biohazard, ChevronDown, Circle, Crown, Flag, Library, Minus, Plus, Radiation, Sparkles, Tickets, Zap }))],
    }).compileComponents();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens and closes the extra player controls menu', () => {
    const fixture = createFixture();

    expect(fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-panel')).toBeNull();

    extraToggle(fixture).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-panel')?.textContent).toContain('Commander damage');
    expect(fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-panel')?.textContent).toContain('Other counters');
    expect(fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-panel')?.textContent).toContain('Opponent');
    expect(fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-panel')?.textContent).toContain('Raggadragga, Goreguts Boss');
    expect(fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-panel')?.textContent).toContain('Poison');
    expect(fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-panel')?.textContent).toContain('Tickets');
    expect(fixture.componentInstance.playerCounterTrackers[0].icon).toBe('biohazard');

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-panel')).toBeNull();
  });

  it('emits life changes from visible life controls and legacy total gestures', () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    const lifeChanged = vi.fn();
    fixture.componentInstance.lifeChanged.subscribe(lifeChanged);

    const lifeButton = fixture.nativeElement.querySelector('[data-testid="life-value"]') as HTMLButtonElement;
    const decreaseButton = fixture.nativeElement.querySelector('[data-testid="life-decrease"]') as HTMLButtonElement;
    const increaseButton = fixture.nativeElement.querySelector('[data-testid="life-increase"]') as HTMLButtonElement;
    const parentContextMenu = vi.fn();
    fixture.nativeElement.addEventListener('contextmenu', parentContextMenu);
    decreaseButton.click();
    increaseButton.click();
    lifeButton.click();
    lifeButton.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    increaseButton.click();
    fixture.detectChanges();

    expect(lifeButton.textContent?.trim()).toBe('41');
    expect(fixture.nativeElement.querySelector('.life-feedback-gain')?.textContent.trim()).toBe('+1');
    expect(fixture.nativeElement.querySelector('.life-feedback-damage')).toBeNull();
    expect(lifeChanged).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PLAYER_SUMMARY_ACTION_DEBOUNCE_MS - 1);
    expect(lifeChanged).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(lifeChanged).toHaveBeenCalledOnce();
    expect(lifeChanged).toHaveBeenCalledWith({ playerId: 'player-1', delta: 1 });
    expect(parentContextMenu).not.toHaveBeenCalled();
  });

  it('shows the quick Concede action when life is zero or below and emits the existing action request', () => {
    const fixture = createFixture({ allowQuickConcede: true, life: 0 });
    const requested = vi.fn();
    fixture.componentInstance.quickConcedeRequested.subscribe(requested);

    const button = fixture.nativeElement.querySelector('[data-testid="player-summary-quick-concede"]') as HTMLButtonElement;

    expect(button.textContent?.trim()).toBe('Concede');
    button.click();

    expect(requested).toHaveBeenCalledOnce();
  });

  it('shows the quick Concede action when any commander damage reaches 21', () => {
    const fixture = createFixture({
      allowQuickConcede: true,
      commanderDamage: {
        'commander-1': 21,
      },
    });

    expect(fixture.nativeElement.querySelector('[data-testid="player-summary-quick-concede"]')).not.toBeNull();
  });

  it('shows one quick Concede action when both thresholds apply', () => {
    const fixture = createFixture({
      allowQuickConcede: true,
      life: 0,
      commanderDamage: { 'commander-1': 21 },
    });

    expect(fixture.nativeElement.querySelectorAll('[data-testid="player-summary-quick-concede"]')).toHaveLength(1);
  });

  it('does not show quick Concede for an active player below both thresholds', () => {
    const fixture = createFixture({ allowQuickConcede: true, life: 1, commanderDamage: { 'commander-1': 20 } });

    expect(fixture.nativeElement.querySelector('[data-testid="player-summary-quick-concede"]')).toBeNull();
  });

  it('clamps life changes between -99 and 499 before emitting', () => {
    vi.useFakeTimers();
    const fixture = createFixture({ life: 499 });
    const lifeChanged = vi.fn();
    fixture.componentInstance.lifeChanged.subscribe(lifeChanged);

    const lifeButton = fixture.nativeElement.querySelector('[data-testid="life-value"]') as HTMLButtonElement;
    const decreaseButton = fixture.nativeElement.querySelector('[data-testid="life-decrease"]') as HTMLButtonElement;
    const increaseButton = fixture.nativeElement.querySelector('[data-testid="life-increase"]') as HTMLButtonElement;

    increaseButton.click();
    fixture.detectChanges();
    vi.advanceTimersByTime(PLAYER_SUMMARY_ACTION_DEBOUNCE_MS);

    expect(lifeButton.textContent?.trim()).toBe('499');
    expect(lifeChanged).not.toHaveBeenCalled();

    decreaseButton.click();
    fixture.detectChanges();
    vi.advanceTimersByTime(PLAYER_SUMMARY_ACTION_DEBOUNCE_MS);

    expect(lifeButton.textContent?.trim()).toBe('498');
    expect(lifeChanged).toHaveBeenCalledOnce();
    expect(lifeChanged).toHaveBeenCalledWith({ playerId: 'player-1', delta: -1 });

    const lowerFixture = createFixture({ life: -99 });
    const lowerLifeChanged = vi.fn();
    lowerFixture.componentInstance.lifeChanged.subscribe(lowerLifeChanged);
    const lowerLifeButton = lowerFixture.nativeElement.querySelector('[data-testid="life-value"]') as HTMLButtonElement;
    const lowerDecreaseButton = lowerFixture.nativeElement.querySelector('[data-testid="life-decrease"]') as HTMLButtonElement;
    const lowerIncreaseButton = lowerFixture.nativeElement.querySelector('[data-testid="life-increase"]') as HTMLButtonElement;

    lowerDecreaseButton.click();
    lowerFixture.detectChanges();
    vi.advanceTimersByTime(PLAYER_SUMMARY_ACTION_DEBOUNCE_MS);

    expect(lowerLifeButton.textContent?.trim()).toBe('-99');
    expect(lowerLifeChanged).not.toHaveBeenCalled();

    lowerIncreaseButton.click();
    lowerFixture.detectChanges();
    vi.advanceTimersByTime(PLAYER_SUMMARY_ACTION_DEBOUNCE_MS);

    expect(lowerLifeButton.textContent?.trim()).toBe('-98');
    expect(lowerLifeChanged).toHaveBeenCalledOnce();
    expect(lowerLifeChanged).toHaveBeenCalledWith({ playerId: 'player-1', delta: 1 });
  });

  it('emits commander damage and player counter changes from the extra controls', () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    const commanderDamageChanged = vi.fn();
    const playerCounterChanged = vi.fn();
    fixture.componentInstance.commanderDamageChanged.subscribe(commanderDamageChanged);
    fixture.componentInstance.playerCounterChanged.subscribe(playerCounterChanged);

    extraToggle(fixture).click();
    fixture.detectChanges();

    const addCommanderDamage = fixture.nativeElement.querySelector('[aria-label^="Add commander damage from Opponent"]') as HTMLButtonElement;
    const removeCommanderDamage = fixture.nativeElement.querySelector('[aria-label^="Remove commander damage from Opponent"]') as HTMLButtonElement;
    const addPoison = fixture.nativeElement.querySelector('[aria-label="Add Poison counter"]') as HTMLButtonElement;
    const removePoison = fixture.nativeElement.querySelector('[aria-label="Remove Poison counter"]') as HTMLButtonElement;

    addCommanderDamage.click();
    addCommanderDamage.click();
    removeCommanderDamage.click();
    removePoison.click();
    removePoison.click();
    addPoison.click();

    expect(commanderDamageChanged).not.toHaveBeenCalled();
    expect(playerCounterChanged).not.toHaveBeenCalled();
    vi.advanceTimersByTime(PLAYER_SUMMARY_ACTION_DEBOUNCE_MS);

    expect(commanderDamageChanged).toHaveBeenCalledOnce();
    expect(playerCounterChanged).toHaveBeenCalledOnce();
    expect(commanderDamageChanged).toHaveBeenCalledWith({
      targetPlayerId: 'player-1',
      sourcePlayerId: 'player-2',
      commanderInstanceId: 'commander-1',
      delta: 1,
    });
    expect(playerCounterChanged).toHaveBeenCalledWith({ playerId: 'player-1', key: 'poison', delta: -1 });
  });

  it('groups commander damage from the same opponent in one row', () => {
    const fixture = createFixture({
      commanderDamage: {
        'commander-1': 11,
        'commander-2': 10,
      },
      opponentCommanders: [
        card('commander-1', 'Rograkh'),
        card('commander-2', 'Silas Renn'),
      ],
    });

    extraToggle(fixture).click();
    fixture.detectChanges();

    const rows = Array.from(fixture.nativeElement.querySelectorAll('.commander-damage-row')) as HTMLElement[];

    expect(rows.length).toBe(1);
    expect(rows[0]!.textContent).toContain('Opponent');
    expect(rows[0]!.textContent).toContain('Rograkh');
    expect(rows[0]!.textContent).toContain('Silas Renn');
    expect(Array.from(rows[0]!.querySelectorAll('.counter-value')).map((value) => value.textContent?.trim())).toEqual(['11', '10']);
    expect(Array.from(rows[0]!.querySelectorAll('.commander-damage-line')).map((line) => line.textContent?.replace(/\s+/g, '').trim())).toEqual([
      expect.stringContaining('Rograkh11-+'),
      expect.stringContaining('SilasRenn10-+'),
    ]);
  });

  it('keeps other counters collapsed by default when every other counter is zero', () => {
    const fixture = createFixture({ counterValues: {} });

    extraToggle(fixture).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[aria-label="Remove Poison counter"]')).toBeNull();

    const otherCountersToggle = fixture.nativeElement.querySelector('.counter-menu-toggle') as HTMLButtonElement;
    expect(otherCountersToggle.getAttribute('aria-expanded')).toBe('false');

    otherCountersToggle.click();
    fixture.detectChanges();

    expect(otherCountersToggle.getAttribute('aria-expanded')).toBe('true');
    expect(fixture.nativeElement.querySelector('[aria-label="Remove Poison counter"]')).not.toBeNull();
  });

  it('renders extra controls as read-only when the player cannot be edited', () => {
    vi.useFakeTimers();
    const fixture = createFixture({ canEditCounters: false });
    const lifeChanged = vi.fn();
    const commanderDamageChanged = vi.fn();
    const playerCounterChanged = vi.fn();
    fixture.componentInstance.lifeChanged.subscribe(lifeChanged);
    fixture.componentInstance.commanderDamageChanged.subscribe(commanderDamageChanged);
    fixture.componentInstance.playerCounterChanged.subscribe(playerCounterChanged);

    extraToggle(fixture).click();
    fixture.detectChanges();

    const addCommanderDamage = fixture.nativeElement.querySelector('[aria-label^="Add commander damage from Opponent"]');
    const removePoison = fixture.nativeElement.querySelector('[aria-label="Remove Poison counter"]');
    const readonlyValues = fixture.nativeElement.querySelectorAll('.counter-readonly-value');
    const lifeDecrease = fixture.nativeElement.querySelector('[data-testid="life-decrease"]');
    const lifeIncrease = fixture.nativeElement.querySelector('[data-testid="life-increase"]');
    const lifeValue = fixture.nativeElement.querySelector('[data-testid="life-value"]') as HTMLButtonElement;

    expect(fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-panel')?.textContent).not.toContain('Read only');
    expect(addCommanderDamage).toBeNull();
    expect(removePoison).toBeNull();
    expect(readonlyValues.length).toBeGreaterThan(0);
    expect(lifeDecrease).toBeNull();
    expect(lifeIncrease).toBeNull();

    fixture.componentInstance.changeCommanderDamage(new MouseEvent('click'), 'player-2', 'commander-1', 1);
    fixture.componentInstance.changePlayerCounter(new MouseEvent('click'), 'poison', -1);
    lifeValue.click();
    vi.advanceTimersByTime(PLAYER_SUMMARY_ACTION_DEBOUNCE_MS);

    expect(lifeChanged).not.toHaveBeenCalled();
    expect(commanderDamageChanged).not.toHaveBeenCalled();
    expect(playerCounterChanged).not.toHaveBeenCalled();
  });

  it('renders optional battlefield context copy and emits the return action', () => {
    const fixture = createFixture({
      contextLabel: 'Estas viendo a:',
      displayName: 'Nombre de jugador extremadamente largo',
      returnActionLabel: 'Ir a tu battlefield',
    });
    const returnRequested = vi.fn();
    fixture.componentInstance.returnRequested.subscribe(returnRequested);

    const returnButton = fixture.nativeElement.querySelector('[data-testid="return-own-battlefield"]') as HTMLButtonElement;

    returnButton.click();

    expect(returnRequested).toHaveBeenCalledOnce();
  });

  it('forwards helper hover previews from the mechanics rail', () => {
    const fixture = createFixture({
      specialEntities: [
        {
          ...helperEntity('citys_blessing', 'player-1'),
          card: {
            scryfallId: 'citys-blessing-1',
            name: "City's Blessing",
            imageUris: { normal: 'https://cards.example/citys-blessing.jpg' },
            cardFaces: [],
            typeLine: 'Card',
            oracleText: null,
            layout: 'token',
          },
        },
      ],
    });
    const previewRequested = vi.fn();
    const previewHidden = vi.fn();
    fixture.componentInstance.helperPreviewRequested.subscribe(previewRequested);
    fixture.componentInstance.helperPreviewHidden.subscribe(previewHidden);

    const helper = fixture.nativeElement.querySelector('.special-entity-pill-card-backed') as HTMLElement;
    helper.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    helper.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    expect(previewRequested).toHaveBeenCalledWith(expect.objectContaining({
      template: 'citys_blessing',
    }));
    expect(previewHidden).toHaveBeenCalled();
  });

  it("forwards City's Blessing context requests from the mechanics rail", () => {
    const fixture = createFixture({
      specialEntities: [
        {
          ...helperEntity('citys_blessing', 'player-1'),
          card: {
            scryfallId: 'citys-blessing-1',
            name: "City's Blessing",
            imageUris: { normal: 'https://cards.example/citys-blessing.jpg' },
            cardFaces: [],
            typeLine: 'Card',
            oracleText: null,
            layout: 'token',
          },
        },
      ],
    });
    const requested = vi.fn();
    fixture.componentInstance.helperContextRequested.subscribe(requested);

    const helper = fixture.nativeElement.querySelector('.special-entity-pill-card-backed') as HTMLElement;
    helper.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    expect(requested).toHaveBeenCalledWith(expect.objectContaining({
      entity: expect.objectContaining({ template: 'citys_blessing' }),
    }));
  });

});

function createFixture(
  options: {
    canEditCounters?: boolean;
    allowQuickConcede?: boolean;
    counterValues?: Partial<Record<string, number>>;
    contextLabel?: string;
    displayName?: string;
    life?: number;
    returnActionLabel?: string;
    commanderDamage?: Record<string, number>;
    opponentCommanders?: GameCardInstance[];
    specialEntities?: readonly GameSpecialEntity[];
  } = {},
): ComponentFixture<PlayerSummaryPanelComponent> {
  const fixture = TestBed.createComponent(PlayerSummaryPanelComponent);
  const currentPlayer = player('player-1', options.displayName ?? 'Player', {
    commanderDamage: options.commanderDamage ?? { 'commander-1': 7 },
    life: options.life,
  });
  const opponent = player('player-2', 'Opponent', {
    command: options.opponentCommanders ?? [card('commander-1', 'Raggadragga, Goreguts Boss')],
  });
  fixture.componentRef.setInput('player', currentPlayer);
  fixture.componentRef.setInput('players', [currentPlayer, opponent]);
  fixture.componentRef.setInput('colorAccent', () => '#d7b46a');
  fixture.componentRef.setInput('deckLabel', () => 'Test deck');
  fixture.componentRef.setInput('manaSymbols', () => ['B', 'G']);
  fixture.componentRef.setInput('playerCounterValue', (_player: PlayerView, key: string) => (
    options.counterValues ? options.counterValues[key] ?? 0 : key === 'poison' ? 3 : 0
  ));
  fixture.componentRef.setInput('canEditCounters', options.canEditCounters ?? true);
  fixture.componentRef.setInput('allowQuickConcede', options.allowQuickConcede ?? false);
  fixture.componentRef.setInput('specialEntities', options.specialEntities ?? []);
  fixture.componentRef.setInput('contextLabel', options.contextLabel ?? null);
  fixture.componentRef.setInput('returnActionLabel', options.returnActionLabel ?? null);
  fixture.detectChanges();

  return fixture;
}

function extraToggle(fixture: ComponentFixture<PlayerSummaryPanelComponent>): HTMLButtonElement {
  return fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-toggle') as HTMLButtonElement;
}

function player(
  id: string,
  displayName: string,
  overrides: {
    command?: GameCardInstance[];
    commanderDamage?: Record<string, number>;
    life?: number;
  } = {},
): PlayerView {
  return {
    id,
    state: {
      user: { id, email: `${id}@test`, displayName, roles: [] },
      status: 'active',
      life: overrides.life ?? 40,
      commanderDamage: overrides.commanderDamage ?? {},
      counters: {},
      zones: {
        library: [],
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
        command: overrides.command ?? [],
      } satisfies Record<GameZoneName, GameCardInstance[]>,
    },
  } as unknown as PlayerView;
}

function card(instanceId: string, name: string): GameCardInstance {
  return {
    instanceId,
    ownerId: 'player-2',
    controllerId: 'player-2',
    name,
    imageUris: {},
    cardFaces: [],
    typeLine: 'Legendary Creature',
    tapped: false,
    isCommander: true,
  };
}

function helperEntity(
  template: GameSpecialEntity['template'],
  ownerPlayerId: string | null,
  state: Record<string, unknown> = {},
): GameSpecialEntity {
  return {
    id: `${template}-${ownerPlayerId ?? 'global'}`,
    template,
    scope: ownerPlayerId ? 'player' : 'global',
    ownerPlayerId,
    card: null,
    state,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}
