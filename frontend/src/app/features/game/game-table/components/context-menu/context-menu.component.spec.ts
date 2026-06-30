import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  Ban,
  BarChart3,
  Biohazard,
  Bug,
  Check,
  Circle,
  Copy,
  Crown,
  Dices,
  Eye,
  EyeOff,
  Gift,
  Ghost,
  Layers3,
  Library,
  Link,
  Link2Off,
  LogOut,
  LucideAngularModule,
  Maximize2,
  Minus,
  MoonStar,
  Pencil,
  Plus,
  Radiation,
  RefreshCcw,
  RotateCcw,
  RotateCw,
  Search,
  Send,
  Skull,
  Sparkles,
  Sun,
  Swords,
  Tickets,
  Trash,
  Trash2,
  Unlink2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-angular';
import { GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { GameContextMenu } from '../../state/core/game-table-ui.state';
import { ContextMenuComponent } from './context-menu.component';
import { ManaSourceSuggestion } from '../../utils/mana-source-detector';

describe('ContextMenuComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContextMenuComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({
          Ban,
          BarChart3,
          Biohazard,
          Bug,
          Check,
          Circle,
          Copy,
          Crown,
          Dices,
          Eye,
          EyeOff,
          Gift,
          Ghost,
          Layers3,
          Library,
          Link,
          Link2Off,
          LogOut,
          Maximize2,
          Minus,
          MoonStar,
          Pencil,
          Plus,
          Radiation,
          RefreshCcw,
          RotateCcw,
          RotateCw,
          Search,
          Send,
          Skull,
          Sparkles,
          Sun,
          Swords,
          Tickets,
          Trash,
          Trash2,
          Unlink2,
          Upload,
          UserPlus,
          Users,
        })),
      ],
    }).compileComponents();
  });

  it('keeps the game menu limited to the table actions with icons', () => {
    const fixture = createContextMenuFixture({
      kind: 'game',
      playerId: 'user-1',
      zone: 'battlefield',
    }, {
      currentPlayer: player('user-1', 'User'),
    });
    const text = menuText(fixture);
    const buttons = menuButtons(fixture);

    expect(buttonLabels(fixture)).toEqual([
      'Refresh snapshot',
      'Focus my board',
      'Open debug',
      'Concede',
      'Leave table',
    ]);
    expect(buttons[3]?.classList).toContain('danger-menu-item');
    expect(buttons[4]?.classList).toContain('danger-menu-item');
    expect((fixture.nativeElement as HTMLElement).querySelector('lucide-icon[name="skull"]')).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('lucide-icon[name="bug"]')).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('lucide-icon')).toHaveLength(5);
    expect(text).not.toContain('Copy game id');
    expect(text).not.toContain('Draw 7 mine');
    expect(text).not.toContain('Open chat');
    expect(text).not.toContain('Shuffle mine');
  });

  it('renders mana pool reset as a gold context menu action', () => {
    const fixture = createContextMenuFixture({
      kind: 'manaPool',
      playerId: 'user-1',
      zone: 'battlefield',
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);
    const button = menuButtons(fixture)[0];

    expect(buttonLabels(fixture)).toEqual(['Empty mana pool']);
    expect(button?.classList).not.toContain('danger-menu-item');
    expect((fixture.nativeElement as HTMLElement).querySelector('lucide-icon[name="rotate-ccw"]')).not.toBeNull();

    button?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'resetManaPool' });
  });

  it('offers selecting all battlefield cards from the battlefield context menu when there are several cards', () => {
    const fixture = createContextMenuFixture({
      kind: 'zone',
      playerId: 'user-1',
      zone: 'battlefield',
    }, {
      zoneCardCount: (_playerId, zone) => zone === 'battlefield' ? 2 : 0,
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    const selectAll = menuButtons(fixture)
      .find((button) => button.textContent?.includes('Select all cards on battlefield'));

    expect(selectAll).toBeDefined();

    selectAll?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'selectAllZoneCards' });
  });

  it('offers selecting all hand cards from a hand card context menu when there are several cards', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'hand',
      card: card('hand-card-1'),
    }, {
      zoneCardCount: (_playerId, zone) => zone === 'hand' ? 3 : 0,
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    const selectAll = menuButtons(fixture)
      .find((button) => button.textContent?.includes('Select all cards in hand'));

    expect(selectAll).toBeDefined();

    selectAll?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'selectAllZoneCards' });
  });

  it('offers selecting all hand cards from the hand zone context menu when there are several cards', () => {
    const fixture = createContextMenuFixture({
      kind: 'zone',
      playerId: 'user-1',
      zone: 'hand',
    }, {
      zoneCardCount: (_playerId, zone) => zone === 'hand' ? 3 : 0,
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    const selectAll = menuButtons(fixture)
      .find((button) => button.textContent?.includes('Select all cards in hand'));

    expect(selectAll).toBeDefined();

    selectAll?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'selectAllZoneCards' });
  });

  it('hides select all zone cards when the active zone has a single card', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'hand',
      card: card('hand-card-1'),
    }, {
      zoneCardCount: (_playerId, zone) => zone === 'hand' ? 1 : 0,
    });

    expect(menuText(fixture)).not.toContain('Select all cards in hand');
  });

  it('does not expose concede in the game menu after the current player has conceded', () => {
    const fixture = createContextMenuFixture({
      kind: 'game',
      playerId: 'user-1',
      zone: 'battlefield',
    }, {
      currentPlayer: player('user-1', 'User', 'conceded'),
    });

    expect(buttonLabels(fixture)).toEqual([
      'Refresh snapshot',
      'Focus my board',
      'Open debug',
      'Leave table',
    ]);
    expect(menuButtons(fixture)[3]?.classList).toContain('danger-menu-item');
  });

  it('exposes add mana for battlefield cards with a mana suggestion', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.75);
    const fixture = createContextMenuFixture({
      kind: 'card',
      zone: 'battlefield',
      card: card('card-1', '{T}: Add {C}{C}.'),
    }, {
      players: [
        player('user-1', 'User', 'active', ['U', 'R']),
        player('user-2', 'Opponent'),
      ],
      manaSourceSuggestion: () => ({
        kind: 'fixed',
        cardName: 'Sol Ring',
        summary: 'Add {C}{C}.',
        additions: [{ color: 'C', amount: 2 }],
        colors: ['C'],
        amount: 0,
        restriction: null,
        manualOnly: false,
      }),
    });

    try {
      expect(buttonLabels(fixture)).toContain('Add mana');
      expect((fixture.nativeElement as HTMLElement).querySelector('.menu-item-mana-icon .ms-r')).not.toBeNull();
      expect((fixture.nativeElement as HTMLElement).querySelector('lucide-icon[name="sparkles"]')).toBeNull();
    } finally {
      random.mockRestore();
    }
  });

  it('hides add mana for manual-only token sources such as Caesar', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      zone: 'battlefield',
      card: {
        ...card('caesar-1'),
        name: "Caesar, Legion's Emperor",
        typeLine: 'Legendary Creature - Human Soldier',
        oracleText: 'Whenever you attack, you may sacrifice another creature. When you do, choose two - Create two Treasure tokens.',
      },
    }, {
      manaSourceSuggestion: () => ({
        kind: 'tokenSource',
        cardName: "Caesar, Legion's Emperor",
        summary: 'This card creates mana-producing tokens. Use the pool manually after resolving it.',
        additions: [],
        colors: [],
        amount: 0,
        restriction: null,
        manualOnly: true,
      }),
    });

    expect(buttonLabels(fixture)).not.toContain('Add mana');
  });

  it('hides add mana for battlefield cards when the mana pool is hidden', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      zone: 'battlefield',
      card: card('card-1', '{T}: Add {G}.'),
    }, {
      isManaPoolHidden: () => true,
      manaSourceSuggestion: () => ({
        kind: 'fixed',
        cardName: 'Forest',
        summary: 'Add {G}.',
        additions: [{ color: 'G', amount: 1 }],
        colors: ['G'],
        amount: 0,
        restriction: null,
        manualOnly: false,
      }),
    });

    expect(buttonLabels(fixture)).not.toContain('Add mana');
  });

  it('emits openDebug from the game menu', () => {
    const fixture = createContextMenuFixture({
      kind: 'game',
      playerId: 'user-1',
      zone: 'battlefield',
    }, {
      currentPlayer: player('user-1', 'User'),
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    const button = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((item) => item.textContent?.includes('Open debug'));
    button?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'openDebug' });
  });

  it('hides player life actions when the current user cannot control that player', () => {
    const fixture = createContextMenuFixture({
      kind: 'player',
      playerId: 'opponent',
      zone: 'battlefield',
    }, {
      canControlPlayer: () => false,
    });

    expect(menuText(fixture)).toContain('Focus player');
    expect(menuText(fixture)).not.toContain('Life -1');
    expect(menuText(fixture)).not.toContain('Life +1');
  });

  it('shows shared move-all targets for graveyard and exile zones', () => {
    const graveyardMenu = createContextMenuFixture({
      kind: 'zone',
      playerId: 'user-1',
      zone: 'graveyard',
    }, {
      zoneCardCount: () => 2,
    });

    expect(menuText(graveyardMenu)).toContain('Move all to');
    expect(menuText(graveyardMenu)).not.toContain('Move all to exile');
    graveyardMenu.componentInstance.toggleSubmenu(new MouseEvent('click'), 'moveAllTo');
    graveyardMenu.detectChanges();

    let text = menuText(graveyardMenu);
    expect((graveyardMenu.nativeElement as HTMLElement).querySelector('.submenu.direction-up')).not.toBeNull();
    expect((graveyardMenu.nativeElement as HTMLElement).querySelector('.submenu.side-left')).not.toBeNull();
    expect((graveyardMenu.nativeElement as HTMLElement).querySelector('.submenu.child-side-left')).not.toBeNull();
    expect(text).toContain('Exile');
    expect(text).toContain('Library');
    expect(text).toContain('Battlefield');
    expect(text).not.toContain('Graveyard');

    const battlefield = Array.from((graveyardMenu.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Battlefield'));
    battlefield?.click();
    graveyardMenu.detectChanges();

    text = menuText(graveyardMenu);
    expect(text).toContain('User');
    expect(text).toContain('Opponent');

    const emptyExileMenu = createContextMenuFixture({
      kind: 'zone',
      playerId: 'user-1',
      zone: 'exile',
    }, {
      zoneCardCount: () => 0,
    });

    expect(menuText(emptyExileMenu)).not.toContain('Move all to graveyard');
    expect(menuText(emptyExileMenu)).not.toContain('Move all to exile');
  });

  it('emits move-all targets from the shared graveyard and exile submenu', () => {
    const fixture = createContextMenuFixture({
      kind: 'zone',
      playerId: 'user-1',
      zone: 'exile',
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    fixture.componentInstance.selectMoveAllTo('zone:library');
    fixture.componentInstance.selectMoveAllTo('battlefield:user-2');

    expect(selected).toHaveBeenCalledWith({ type: 'moveAll', zone: 'library' });
    expect(selected).toHaveBeenCalledWith({ type: 'moveAll', zone: 'battlefield', targetPlayerId: 'user-2' });
  });

  it('keeps the empty battlefield menu limited to table battlefield actions', () => {
    const fixture = createContextMenuFixture({
      kind: 'zone',
      playerId: 'user-1',
      zone: 'battlefield',
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    expect(buttonLabels(fixture)).toEqual(['Create token', 'Game mechanics›', 'Roll dice']);
    expect(menuText(fixture)).not.toContain('View');
    expect(menuText(fixture)).not.toContain('Move all');

    const button = (fixture.nativeElement as HTMLElement).querySelector('button') as HTMLButtonElement;
    button.click();

    expect(selected).toHaveBeenCalledWith({ type: 'createToken' });

    const rollButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.includes('Roll dice'));
    rollButton?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'rollDice' });
  });

  it('shows battlefield game mechanics and emits monarch, initiative, day-night and card-backed helper searches', () => {
    const fixture = createContextMenuFixture({
      kind: 'zone',
      playerId: 'user-1',
      zone: 'battlefield',
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'gameMechanics');
    fixture.detectChanges();

    expect(menuText(fixture)).toContain('Add the Monarch');
    expect(menuText(fixture)).toContain('Add the Initiative');
    expect(menuText(fixture)).toContain('Add Day / Night');
    expect(menuText(fixture)).toContain('Add The Ring');
    expect(menuText(fixture)).toContain('Add Dungeon');
    expect(menuText(fixture)).toContain("Get the City's Blessing");
    expect(menuText(fixture)).toContain('Add Emblem');
    expect(fixture.componentInstance.gameMechanicsMenuItems().map((item) => item.icon)).toEqual([
      'ms-ability-role-royal',
      'ms-ability-d20',
      'ms-ability-day-night',
      'ms-ability-the-ring-tempts-you',
      'ms-ability-dungeon',
      'ms-ability-ascend',
      'ms-planeswalker',
    ]);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.submenu-panel lucide-icon')).toHaveLength(0);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.submenu-item-mana-icon')).toHaveLength(7);
    expect((fixture.nativeElement as HTMLElement).querySelector('.submenu-item-mana-icon.ms-ability-the-ring-tempts-you')).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.submenu-item-mana-icon.ms-planeswalker')).not.toBeNull();

    const monarchButton = menuButtons(fixture)
      .find((candidate) => candidate.textContent?.includes('Add the Monarch'));
    monarchButton?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'createMonarch' });

    const initiativeButton = menuButtons(fixture)
      .find((candidate) => candidate.textContent?.includes('Add the Initiative'));
    initiativeButton?.click();

    const dayNightButton = menuButtons(fixture)
      .find((candidate) => candidate.textContent?.includes('Add Day / Night'));
    dayNightButton?.click();

    const theRingButton = menuButtons(fixture)
      .find((candidate) => candidate.textContent?.includes('Add The Ring'));
    theRingButton?.click();

    const dungeonButton = menuButtons(fixture)
      .find((candidate) => candidate.textContent?.includes('Add Dungeon'));
    dungeonButton?.click();

    const citysBlessingButton = menuButtons(fixture)
      .find((candidate) => candidate.textContent?.includes("Get the City's Blessing"));
    citysBlessingButton?.click();

    const emblemButton = menuButtons(fixture)
      .find((candidate) => candidate.textContent?.includes('Add Emblem'));
    emblemButton?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'createInitiative' });
    expect(selected).toHaveBeenCalledWith({ type: 'createDayNight' });
    expect(selected).toHaveBeenCalledWith({ type: 'createTheRing' });
    expect(selected).toHaveBeenCalledWith({ type: 'openGameplayCardSearch', kind: 'dungeon' });
    expect(selected).toHaveBeenCalledWith({ type: 'createCitysBlessing' });
    expect(selected).toHaveBeenCalledWith({ type: 'openGameplayCardSearch', kind: 'emblem' });
    expect(selected).toHaveBeenCalledTimes(7);
  });

  it('hides Add The Ring from game mechanics when the player already controls one', () => {
    const fixture = createContextMenuFixture({
      kind: 'zone',
      playerId: 'user-1',
      zone: 'battlefield',
    }, {
      playerHasTheRing: (playerId) => playerId === 'user-1',
    });

    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'gameMechanics');
    fixture.detectChanges();

    expect(menuText(fixture)).not.toContain('Add The Ring');
    expect(fixture.componentInstance.gameMechanicsMenuItems().map((item) => item.value)).toEqual([
      'monarch',
      'initiative',
      'day-night',
      'dungeon',
      'citys-blessing',
      'emblem',
    ]);
  });

  it('hides day-night and adjusts monarch and initiative from battlefield game mechanics when those mechanics are active', () => {
    const fixture = createContextMenuFixture({
      kind: 'zone',
      playerId: 'user-1',
      zone: 'battlefield',
    }, {
      currentPlayer: player('user-1', 'User'),
      activeDayNight: true,
      monarchOwnerPlayerId: 'user-2',
      initiativeOwnerPlayerId: 'user-2',
    });

    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'gameMechanics');
    fixture.detectChanges();

    expect(menuText(fixture)).toContain('Become the Monarch');
    expect(menuText(fixture)).toContain('Take the Initiative');
    expect(menuText(fixture)).not.toContain('Add the Monarch');
    expect(menuText(fixture)).not.toContain('Add the Initiative');
    expect(menuText(fixture)).not.toContain('Add Day / Night');
  });

  it('hides monarch and initiative from battlefield game mechanics when the current player already has them', () => {
    const fixture = createContextMenuFixture({
      kind: 'zone',
      playerId: 'user-1',
      zone: 'battlefield',
    }, {
      currentPlayer: player('user-1', 'User'),
      monarchOwnerPlayerId: 'user-1',
      initiativeOwnerPlayerId: 'user-1',
    });

    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'gameMechanics');
    fixture.detectChanges();

    expect(menuText(fixture)).not.toContain('Add the Monarch');
    expect(menuText(fixture)).not.toContain('Become the Monarch');
    expect(menuText(fixture)).not.toContain('Add the Initiative');
    expect(menuText(fixture)).not.toContain('Take the Initiative');
  });

  it("switches City's Blessing game mechanics entry to remove when that player already has it", () => {
    const fixture = createContextMenuFixture({
      kind: 'zone',
      playerId: 'user-1',
      zone: 'battlefield',
    }, {
      playerHasCitysBlessing: (playerId) => playerId === 'user-1',
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'gameMechanics');
    fixture.detectChanges();

    expect(menuText(fixture)).toContain("Remove the City's Blessing");
    expect(menuText(fixture)).not.toContain("Get the City's Blessing");

    const removeButton = menuButtons(fixture)
      .find((candidate) => candidate.textContent?.includes("Remove the City's Blessing"));
    removeButton?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'removeCitysBlessing' });
  });

  it('shows only remove and give-to actions for monarch cards', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: {
        instanceId: 'monarch:entity-1',
        ownerId: 'user-1',
        controllerId: 'user-1',
        name: 'Monarch',
        layout: 'monarch',
        typeLine: 'Game Mechanic - Monarch',
        tapped: false,
        zone: 'battlefield',
      },
    }, {
      currentPlayer: player('user-1', 'User'),
      players: [
        player('user-1', 'User'),
        player('user-2', 'Opponent'),
      ],
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    expect(buttonLabels(fixture)).toEqual(['Give to›', 'Remove']);
    expect(menuText(fixture)).not.toContain('Tap');
    expect(menuText(fixture)).not.toContain('Attach');
    expect(menuText(fixture)).not.toContain('Move to');

    menuButtons(fixture)
      .find((candidate) => candidate.textContent?.includes('Remove'))
      ?.click();

    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'giveMonarchToPlayer');
    fixture.detectChanges();
    menuButtons(fixture)
      .find((candidate) => candidate.textContent?.includes('Opponent'))
      ?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'removeMonarch' });
    expect(selected).toHaveBeenCalledWith({ type: 'giveMonarchToPlayer', targetPlayerId: 'user-2' });
  });

  it('lets the current monarch give monarch even when they did not create it', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: {
        instanceId: 'monarch:entity-1',
        ownerId: 'user-1',
        controllerId: 'user-2',
        name: 'Monarch',
        layout: 'monarch',
        typeLine: 'Game Mechanic - Monarch',
        tapped: false,
        zone: 'battlefield',
      },
    }, {
      currentPlayer: player('user-2', 'Opponent'),
      players: [
        player('user-1', 'User'),
        player('user-2', 'Opponent'),
        player('user-3', 'Third'),
      ],
      canControlPlayer: (playerId) => playerId === 'user-2',
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    expect(buttonLabels(fixture)).toEqual(['Give to›', 'Remove']);

    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'giveMonarchToPlayer');
    fixture.detectChanges();

    expect(menuText(fixture)).toContain('User');
    expect(menuText(fixture)).toContain('Third');
    expect(menuText(fixture)).not.toContain('Opponent');

    menuButtons(fixture)
      .find((candidate) => candidate.textContent?.includes('Third'))
      ?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'giveMonarchToPlayer', targetPlayerId: 'user-3' });
  });

  it('shows only remove and give-to actions for initiative cards', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: {
        instanceId: 'initiative:entity-1',
        ownerId: 'user-1',
        controllerId: 'user-1',
        name: 'The Initiative',
        layout: 'initiative',
        typeLine: 'Game Mechanic - Initiative',
        tapped: false,
        zone: 'battlefield',
      },
    }, {
      currentPlayer: player('user-1', 'User'),
      players: [
        player('user-1', 'User'),
        player('user-2', 'Opponent'),
      ],
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    expect(buttonLabels(fixture)[0]).toContain('Give to');
    expect(buttonLabels(fixture)[1]).toBe('Remove');
    expect(menuText(fixture)).not.toContain('Tap');
    expect(menuText(fixture)).not.toContain('Attach');
    expect(menuText(fixture)).not.toContain('Move to');

    menuButtons(fixture)
      .find((candidate) => candidate.textContent?.includes('Remove'))
      ?.click();

    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'giveInitiativeToPlayer');
    fixture.detectChanges();
    menuButtons(fixture)
      .find((candidate) => candidate.textContent?.includes('Opponent'))
      ?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'removeInitiative' });
    expect(selected).toHaveBeenCalledWith({ type: 'giveInitiativeToPlayer', targetPlayerId: 'user-2' });
  });

  it('lets the current initiative holder give initiative even when they did not create it', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: {
        instanceId: 'initiative:entity-1',
        ownerId: 'user-1',
        controllerId: 'user-2',
        name: 'The Initiative',
        layout: 'initiative',
        typeLine: 'Game Mechanic - Initiative',
        tapped: false,
        zone: 'battlefield',
      },
    }, {
      currentPlayer: player('user-2', 'Opponent'),
      players: [
        player('user-1', 'User'),
        player('user-2', 'Opponent'),
        player('user-3', 'Third'),
      ],
      canControlPlayer: (playerId) => playerId === 'user-2',
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    expect(buttonLabels(fixture)[0]).toContain('Give to');
    expect(buttonLabels(fixture)[1]).toBe('Remove');

    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'giveInitiativeToPlayer');
    fixture.detectChanges();

    expect(menuText(fixture)).toContain('User');
    expect(menuText(fixture)).toContain('Third');
    expect(menuText(fixture)).not.toContain('Opponent');

    menuButtons(fixture)
      .find((candidate) => candidate.textContent?.includes('Third'))
      ?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'giveInitiativeToPlayer', targetPlayerId: 'user-3' });
  });

  it('opens forced-left mechanic card submenus to the left', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      forceOpenLeft: true,
      card: {
        instanceId: 'monarch:entity-1',
        ownerId: 'user-1',
        controllerId: 'user-1',
        name: 'Monarch',
        layout: 'monarch',
        typeLine: 'Game Mechanic - Monarch',
        tapped: false,
        zone: 'battlefield',
      },
    }, {
      currentPlayer: player('user-1', 'User'),
      players: [
        player('user-1', 'User'),
        player('user-2', 'Opponent'),
      ],
    });

    expect((fixture.nativeElement as HTMLElement).querySelector('.context-menu.side-left-menu')).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.submenu.side-left')).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.submenu.child-side-left')).not.toBeNull();
  });

  it('shows only day-night toggle and creator remove actions for day-night cards', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: {
        instanceId: 'battlefield-day-night-1',
        ownerId: 'user-1',
        controllerId: 'user-1',
        name: 'Day // Night',
        layout: 'double_faced_token',
        typeLine: 'Card // Card',
        activeFaceIndex: 0,
        tapped: false,
        zone: 'battlefield',
      },
    }, {
      currentPlayer: player('user-1', 'User'),
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    expect(menuText(fixture)).toContain('Make night');
    expect(menuText(fixture)).toContain('Remove');
    expect(menuText(fixture)).not.toContain('Tap');
    expect(menuText(fixture)).not.toContain('Attach');

    menuButtons(fixture)
      .find((candidate) => candidate.textContent?.includes('Make night'))
      ?.click();
    menuButtons(fixture)
      .find((candidate) => candidate.textContent?.includes('Remove'))
      ?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'setDayNightMode', mode: 'night' });
    expect(selected).toHaveBeenCalledWith({ type: 'removeDayNight' });
  });

  it('uses the sun icon when the day-night action changes the marker to day', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: {
        instanceId: 'battlefield-day-night-1',
        ownerId: 'user-1',
        controllerId: 'user-1',
        name: 'Day // Night',
        layout: 'double_faced_token',
        typeLine: 'Card // Card',
        activeFaceIndex: 1,
        tapped: false,
        zone: 'battlefield',
      },
    }, {
      currentPlayer: player('user-1', 'User'),
    });

    expect(menuText(fixture)).toContain('Make day');
    expect(fixture.componentInstance.dayNightToggleIcon()).toBe('sun');
  });

  it('does not offer the legacy mechanics modal from the command zone menu', () => {
    const fixture = createContextMenuFixture({
      kind: 'zone',
      playerId: 'user-1',
      zone: 'command',
    });

    const button = menuButtons(fixture)
      .find((candidate) => candidate.textContent?.includes('Mechanics'));

    expect(button).toBeUndefined();
  });

  it('shows the mana pool opener from the own battlefield menu only when the panel is hidden', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.75);
    const visible = createContextMenuFixture({
      kind: 'zone',
      playerId: 'user-1',
      zone: 'battlefield',
    }, {
      players: [
        player('user-1', 'User', 'active', ['U', 'R']),
        player('user-2', 'Opponent'),
      ],
    });
    const hidden = createContextMenuFixture({
      kind: 'zone',
      playerId: 'user-1',
      zone: 'battlefield',
    }, {
      isManaPoolHidden: () => true,
      players: [
        player('user-1', 'User', 'active', ['U', 'R']),
        player('user-2', 'Opponent'),
      ],
    });
    const selected = vi.fn();
    hidden.componentInstance.actionSelected.subscribe(selected);

    try {
      expect(menuText(visible)).not.toContain('Show mana pool');
      expect(buttonLabels(hidden)).toEqual(['Create token', 'Game mechanics›', 'Roll dice', 'Show mana pool']);
      expect((hidden.nativeElement as HTMLElement).querySelector('.menu-item-mana-icon .ms-r')).not.toBeNull();
      expect((hidden.nativeElement as HTMLElement).querySelector('lucide-icon[name="sparkles"]')).toBeNull();

      const showButton = Array.from((hidden.nativeElement as HTMLElement).querySelectorAll('button'))
        .find((candidate) => candidate.textContent?.includes('Show mana pool'));
      showButton?.click();

      expect(selected).toHaveBeenCalledWith({ type: 'showManaPool' });
    } finally {
      random.mockRestore();
    }
  });

  it('does not offer the legacy Ring-bearer helper action for creatures', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: { ...card('creature-1'), typeLine: 'Creature - Halfling Rogue' },
    }, {
      canControlPlayer: () => true,
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    const button = menuButtons(fixture)
      .find((candidate) => candidate.textContent?.includes('Set as ring-bearer'));

    expect(button).toBeUndefined();
    expect(selected).not.toHaveBeenCalled();
  });

  it('uses distinct card options for library cards and shared options for graveyard and exile cards', () => {
    const libraryMenu = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'library',
      card: card('library-card'),
    });
    const graveyardMenu = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'graveyard',
      card: card('graveyard-card'),
    });
    const exileMenu = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'exile',
      card: card('exile-card'),
    });

    expect(menuText(libraryMenu)).not.toContain('Reveal');
    expect(menuText(libraryMenu)).not.toContain('Select random card');
    expect(menuText(libraryMenu)).not.toContain("Create a token that's a copy");
    expect(menuText(graveyardMenu)).toContain("Create a token that's a copy");
    expect(menuText(graveyardMenu)).toContain('Select random card');
    expect(menuText(exileMenu)).toContain("Create a token that's a copy");
    expect(menuText(exileMenu)).toContain('Select random card');
    expect(menuText(graveyardMenu)).not.toContain('Reveal');
    expect(menuText(exileMenu)).not.toContain('Reveal');
  });

  it('keeps hand card options to actions that are meaningful outside the battlefield', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'hand',
      card: card('card-1'),
    });
    const text = menuText(fixture);

    expect(text).toContain('Reveal');
    expect(text).toContain("Create a token that's a copy");
    expect(text).toContain('Play face down');
    expect(text).toContain('Give to');
    expect(text).toContain('Select random card');
    expect(text).not.toContain('Add to stack');
    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'giveToPlayer');
    fixture.detectChanges();
    const giveText = menuText(fixture);
    expect(giveText).toContain('Opponent');
    expect(giveText).not.toContain('User');
    expect((fixture.nativeElement as HTMLElement).querySelector('.submenu.direction-up')).not.toBeNull();
    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'moveTo');
    fixture.detectChanges();
    expect(menuText(fixture)).toContain('Battlefield');
    expect((fixture.nativeElement as HTMLElement).querySelector('.submenu.direction-up')).not.toBeNull();
    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'revealTo');
    fixture.detectChanges();
    const revealText = menuText(fixture);
    expect(revealText).toContain('All');
    expect(revealText).toContain('User');
    expect(revealText).toContain('Opponent');
    expect((fixture.nativeElement as HTMLElement).querySelector('.submenu.direction-up')).not.toBeNull();
    expect(text).not.toContain('Tap / untap');
    expect(text).not.toContain('Power/Toughness');
    expect(text).not.toContain('Move to hand');
  });

  it('reveals hand cards to a selected player from the reveal submenu', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'hand',
      card: card('card-1'),
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    fixture.componentInstance.selectRevealTarget('user-2');

    expect(selected).toHaveBeenCalledWith({ type: 'revealCard', target: 'user-2' });
  });

  it('shows tap actions for saga cards on the battlefield', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: {
        ...card('saga-1'),
        typeLine: 'Enchantment - Saga',
      },
    });

    expect(menuText(fixture)).toContain('Tap');
    expect(menuText(fixture)).not.toContain('Untap');
  });

  it('emits hand give and play face down actions', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'hand',
      card: card('card-1'),
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    const playFaceDown = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Play face down'));
    playFaceDown?.click();
    fixture.componentInstance.selectGiveToPlayer('user-2');

    expect(selected).toHaveBeenCalledWith({ type: 'playFaceDown' });
    expect(selected).toHaveBeenCalledWith({ type: 'giveToPlayer', zone: 'hand', targetPlayerId: 'user-2' });
  });

  it('shows battlefield and hand destinations before player names for random modal cards', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'graveyard',
      card: card('random-card'),
      fromFixedZoneModal: true,
      suppressRandomSelect: true,
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'giveToPlayer');
    fixture.detectChanges();

    const text = menuText(fixture);
    expect(text).toContain('Give to');
    expect(text).toContain('Battlefield');
    expect(text).toContain('Hand');

    fixture.componentInstance.selectGiveToDestination('battlefield:user-2');
    fixture.componentInstance.selectGiveToDestination('hand:user-2');

    expect(selected).toHaveBeenCalledWith({ type: 'giveToPlayer', zone: 'battlefield', targetPlayerId: 'user-2' });
    expect(selected).toHaveBeenCalledWith({ type: 'giveToPlayer', zone: 'hand', targetPlayerId: 'user-2' });
  });

  it('emits select random from zone menus', () => {
    const fixture = createContextMenuFixture({
      kind: 'zone',
      playerId: 'user-1',
      zone: 'library',
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    const button = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.includes('Select random card'));
    button?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'selectRandomCard' });
  });

  it('hides select random when the card menu comes from a fixed modal', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'graveyard',
      card: card('random-card'),
      suppressRandomSelect: true,
    });

    expect(menuText(fixture)).not.toContain('Select random card');
  });

  it('exposes the requested library menu structure and emits nested actions', () => {
    const fixture = createContextMenuFixture({
      kind: 'zone',
      playerId: 'user-1',
      zone: 'library',
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    expect(buttonLabels(fixture)).toEqual([
      'Draw a card D',
      'Draw X cards',
      'Move top›',
      'Reveal top card›',
      'Reveal library›',
      'Play with top card revealed',
      'Shuffle S',
      'Select random card',
      'View›',
    ]);

    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'libraryMoveTop');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.context-menu.side-left-menu')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.submenu.direction-up')).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.submenu.side-left')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.submenu.child-side-left')).toBeNull();
    expect(menuText(fixture)).toContain('Put X on bottom of library');
    expect(menuText(fixture)).toContain("Put X into a player's hand");
    fixture.componentInstance.selectLibraryMoveTop('zone:library');
    fixture.componentInstance.selectLibraryMoveTop('hand:user-2');
    fixture.componentInstance.selectLibraryMoveTop('battlefield:user-2');

    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'libraryRevealTop');
    fixture.componentInstance.selectLibraryRevealTopTarget('user-2');
    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'libraryReveal');
    fixture.componentInstance.selectLibraryRevealTarget('user-2');
    const playTopButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Play with top card revealed'));
    playTopButton?.click();
    fixture.componentInstance.selectLibraryView('top');
    fixture.componentInstance.selectLibraryView('all');

    expect(selected).toHaveBeenCalledWith({ type: 'moveTop', zone: 'library', position: 'bottom' });
    expect(selected).toHaveBeenCalledWith({ type: 'moveTop', zone: 'hand', targetPlayerId: 'user-2' });
    expect(selected).toHaveBeenCalledWith({ type: 'moveTop', zone: 'battlefield', targetPlayerId: 'user-2' });
    expect(selected).toHaveBeenCalledWith({ type: 'revealTop', target: 'user-2' });
    expect(selected).toHaveBeenCalledWith({ type: 'revealLibrary', targetPlayerId: 'user-2' });
    expect(selected).toHaveBeenCalledWith({ type: 'playTopRevealed', enabled: true });
    expect(selected).toHaveBeenCalledWith({ type: 'openLibraryView', mode: 'top' });
    expect(selected).toHaveBeenCalledWith({ type: 'openLibraryView', mode: 'all' });
  });

  it('opens library submenus to the left in aggressive compact mode', () => {
    const restoreMatchMedia = mockMatchMedia(true);
    try {
      const fixture = createContextMenuFixture({
        kind: 'zone',
        playerId: 'user-1',
        zone: 'library',
      });

      fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'libraryMoveTop');
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).querySelector('.context-menu.side-left-menu')).not.toBeNull();
      expect((fixture.nativeElement as HTMLElement).querySelector('.submenu.side-left')).not.toBeNull();
      expect((fixture.nativeElement as HTMLElement).querySelector('.submenu.child-side-left')).not.toBeNull();
    } finally {
      restoreMatchMedia();
    }
  });

  it('keeps battlefield card actions and omits moving to the current zone', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: { ...card('card-1'), power: 2, toughness: 2 },
    });
    const text = menuText(fixture);

    expect(text).toContain('Tap');
    expect(text).toContain('Turn face down');
    expect(text).toContain('power/toughness');
    expect(text).toContain('Counters');
    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'counters');
    fixture.detectChanges();
    const countersText = menuText(fixture);
    expect(countersText).toContain('+1/+1');
    expect(countersText).toContain('White');
    expect(countersText).not.toContain('Charge');
    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'giveToPlayer');
    fixture.detectChanges();
    const giveText = menuText(fixture);
    expect(giveText).toContain('Opponent');
    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'moveTo');
    fixture.detectChanges();
    const moveText = menuText(fixture);
    expect(moveText).toContain('Hand');
    expect(moveText).not.toContain('Battlefield');
    expect((fixture.nativeElement as HTMLElement).querySelector('.submenu.direction-up')).toBeNull();
  });

  it('shows remove stack only for battlefield cards that belong to a land stack', () => {
    const stacked = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: card('stacked-land'),
    }, {
      isLandStacked: (_playerId, target) => target.instanceId === 'stacked-land',
    });
    const loose = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: card('loose-land'),
    }, {
      isLandStacked: () => false,
    });

    expect(menuText(stacked)).toContain('Remove from stack');
    expect(menuText(loose)).not.toContain('Remove from stack');
  });

  it('limits an emblem battlefield card menu to remove', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: emblemCard('emblem-1'),
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    expect(buttonLabels(fixture)).toEqual(['Remove']);
    expect(menuText(fixture)).not.toContain('Attach to...');
    expect(menuText(fixture)).not.toContain('Move to');
    expect(menuText(fixture)).not.toContain('Counters');

    menuButtons(fixture)[0]?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'moveCard', zone: 'graveyard' });
  });

  it('does not add remove stack to a stacked emblem battlefield card menu', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: emblemCard('stacked-emblem'),
    }, {
      isLandStacked: (_playerId, target) => target.instanceId === 'stacked-emblem',
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    expect(buttonLabels(fixture)).toEqual(['Remove']);
    expect(menuText(fixture)).not.toContain('Remove from stack');
  });

  it('limits a dungeon battlefield card menu to remove without stack actions', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: dungeonCard('dungeon-1'),
    }, {
      isLandStacked: () => true,
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    expect(buttonLabels(fixture)).toEqual(['Remove']);
    expect(menuText(fixture)).not.toContain('Remove from stack');
    expect(menuText(fixture)).not.toContain('Attach to...');
    expect(menuText(fixture)).not.toContain('Move to');
    expect(menuText(fixture)).not.toContain('Counters');

    menuButtons(fixture)[0]?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'moveCard', zone: 'graveyard' });
  });

  it('shows Add venture for battlefield cards with venture text', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: card('venture-card', 'When this enters, venture into the dungeon.'),
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    expect(buttonLabels(fixture)).toContain('Add venture');

    menuButtons(fixture)
      .find((button) => button.textContent?.includes('Add venture'))
      ?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'addVenture', kind: 'venture' });
  });

  it('uses initiative action for battlefield cards that take the initiative', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: card('initiative-card', 'When this enters, you take the initiative. Whenever you venture into the dungeon, draw a card.'),
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    menuButtons(fixture)
      .find((button) => button.textContent?.includes('Add venture'))
      ?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'addVenture', kind: 'initiative' });
  });

  it('does not show Add venture for unrelated battlefield cards', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: card('normal-card', 'Search your library for a Dungeon Master.'),
    });

    expect(buttonLabels(fixture)).not.toContain('Add venture');
  });

  it('shows attach only for valid battlefield source cards', () => {
    const nonLand = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: card('artifact-card'),
    });
    const land = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: { ...card('land-card'), typeLine: 'Basic Land - Forest' },
    }, {
      canAttachEquipment: (_playerId, target) => !/\bland\b/i.test(target.typeLine ?? ''),
    });
    const attachmentTarget = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: card('attachment-target'),
    }, {
      canAttachEquipment: (_playerId, target) => target.instanceId !== 'attachment-target',
    });

    expect(menuText(nonLand)).toContain('Attach to...');
    expect(menuText(land)).not.toContain('Attach to...');
    expect(menuText(attachmentTarget)).not.toContain('Attach to...');
  });

  it('lets The Ring start attachment targeting but hides face flipping and counters', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: theRingCard('the-ring'),
    }, {
      canAttachEquipment: (_playerId, target) => target.instanceId === 'the-ring',
    });

    expect(menuText(fixture)).toContain('Attach to...');
    expect(menuText(fixture)).not.toContain('Counters');
    expect(menuText(fixture)).not.toContain('Flip Card Face');
  });

  it('shows detach all for a battlefield card with attached cards', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: card('target-card'),
    }, {
      isAttachmentTarget: (_playerId, target) => target.instanceId === 'target-card',
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    const detachAll = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.includes('Detach all attached'));
    detachAll?.click();

    expect(menuText(fixture)).toContain('Detach all attached');
    expect(selected).toHaveBeenCalledWith({ type: 'unequipAttachedCards' });
  });

  it('emits removeStack from a stacked battlefield card menu', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: card('stacked-land'),
    }, {
      isLandStacked: () => true,
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    const removeStack = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.includes('Remove from stack'));
    removeStack?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'removeStack' });
  });

  it('hides power toughness counters for cards without a power toughness box', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: card('artifact-1'),
    });

    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'counters');
    fixture.detectChanges();

    const text = menuText(fixture);
    expect(text).not.toContain('+1/+1');
    expect(text).not.toContain('-1/-1');
    expect(text).toContain('Red');
  });

  it('allows moving a viewed library card to the bottom of its library', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'library',
      card: card('library-card'),
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'moveTo');
    fixture.detectChanges();

    expect(menuText(fixture)).toContain('Bottom of library');

    fixture.componentInstance.selectMoveTo('library:bottom');

    expect(selected).toHaveBeenCalledWith({ type: 'moveCard', zone: 'library', position: 'bottom' });
  });

  it('allows giving cards from the view-all library modal to active players', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'library',
      card: card('library-card'),
      fromFixedZoneModal: true,
    }, {
      players: [
        player('user-1', 'User'),
        player('user-2', 'Opponent'),
        player('user-3', 'Defeated', 'conceded'),
      ],
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'giveToPlayer');
    fixture.detectChanges();

    const text = menuText(fixture);
    expect(text).toContain('Give to');
    expect(text).toContain('Battlefield');
    expect(text).toContain('Hand');
    expect(text).not.toContain('Defeated');
    expect(fixture.componentInstance.giveToDestinationMenuItems()).toEqual([
      expect.objectContaining({
        value: 'battlefield',
        children: [expect.objectContaining({ value: 'battlefield:user-2', label: 'Opponent' })],
      }),
      expect.objectContaining({
        value: 'hand',
        children: [expect.objectContaining({ value: 'hand:user-2', label: 'Opponent' })],
      }),
    ]);

    fixture.componentInstance.selectGiveToDestination('battlefield:user-2');
    fixture.componentInstance.selectGiveToDestination('hand:user-2');

    expect(selected).toHaveBeenCalledWith({ type: 'giveToPlayer', zone: 'battlefield', targetPlayerId: 'user-2' });
    expect(selected).toHaveBeenCalledWith({ type: 'giveToPlayer', zone: 'hand', targetPlayerId: 'user-2' });
  });

  it('uses dynamic battlefield labels and only exposes command moves for commanders', () => {
    const tappedCommander = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: { ...card('commander-1'), tapped: true, faceDown: true, isCommander: true },
    });
    tappedCommander.componentInstance.toggleSubmenu(new MouseEvent('click'), 'moveTo');
    tappedCommander.detectChanges();
    const commanderText = menuText(tappedCommander);

    expect(commanderText).toContain('Untap');
    expect(commanderText).toContain('Turn face up');
    const commanderMoveIcon = Array.from((tappedCommander.nativeElement as HTMLElement).querySelectorAll('img'))
      .find((image) => image.getAttribute('src')?.includes('/assets/icons/CZ/CZ_logo_zone_header.webp'));
    expect(commanderMoveIcon).not.toBeUndefined();

    const regularCard = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: card('card-1'),
    });
    regularCard.componentInstance.toggleSubmenu(new MouseEvent('click'), 'moveTo');
    regularCard.detectChanges();

    expect(menuText(regularCard)).not.toContain('Command');
  });

  it('hides power toughness setup when the battlefield card already has visible stats', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: { ...card('creature-1'), power: 2, toughness: 2, defaultPower: 2, defaultToughness: 2 },
    });

    expect(menuText(fixture)).not.toContain('Power/Toughness');
  });

  it('shows manual power toughness removal when the card has no backend defaults', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: { ...card('artifact-token'), power: 3, toughness: 3 },
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    const button = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.includes('Remove power/toughness'));
    button?.click();

    expect(menuText(fixture)).toContain('Remove power/toughness');
    expect(selected).toHaveBeenCalledWith({ type: 'clearPowerToughness' });
  });

  it('does not show manual power toughness removal when backend defaults exist', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: { ...card('creature-1'), power: 2, toughness: 2, defaultPower: 2, defaultToughness: 2 },
    });

    expect(menuText(fixture)).not.toContain('Remove power/toughness');
  });

  it('shows a compact delete action for arrow menus', () => {
    const fixture = createContextMenuFixture({
      kind: 'arrow',
      playerId: 'user-1',
      zone: 'battlefield',
      arrowId: 'arrow-1',
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    const button = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.includes('Delete arrow'));
    button?.click();

    expect(menuText(fixture)).toContain('Delete arrow');
    expect(selected).toHaveBeenCalledWith({ type: 'deleteArrow' });
  });

  it('shows delete arrows when the current player owns several arrows', () => {
    const fixture = createContextMenuFixture({
      kind: 'arrow',
      playerId: 'user-1',
      zone: 'battlefield',
      arrowId: 'arrow-1',
    }, {
      ownedArrowCount: 3,
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    const button = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.includes('Delete arrows'));
    button?.click();

    expect(menuText(fixture)).toContain('Delete arrow');
    expect(menuText(fixture)).toContain('Delete arrows');
    expect(selected).toHaveBeenCalledWith({ type: 'deleteArrows' });
  });

  it('shows a compact delete action for counter menus', () => {
    const fixture = createContextMenuFixture({
      kind: 'counter',
      playerId: 'user-1',
      zone: 'battlefield',
      card: card('card-1'),
      counterKey: 'red',
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    const button = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.includes('Delete counter'));
    button?.click();

    expect(menuText(fixture)).toContain('Delete counter');
    expect(selected).toHaveBeenCalledWith({ type: 'deleteCounter' });
  });

  it('emits close when the user clicks outside the context menu', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: card('card-1'),
    });
    const close = vi.fn();
    fixture.componentInstance.close.subscribe(close);

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(close).toHaveBeenCalledOnce();
  });

  it('turns existing counters into remove actions and exposes remove all when there are several', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: { ...card('card-1'), counters: { red: 2, green: 1 } },
    });
    const selected = vi.fn();
    fixture.componentInstance.actionSelected.subscribe(selected);

    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'counters');
    fixture.detectChanges();

    const text = menuText(fixture);
    expect(text).toContain('Remove red');
    expect(text).toContain('Remove green');
    expect(text).toContain('Remove all counters');

    const removeRed = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.includes('Remove red'));
    removeRed?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'removeCounter', counter: 'red' });
  });
});

interface ContextMenuFixtureOptions {
  canControlPlayer?: (playerId: string) => boolean;
  currentPlayer?: ReturnType<typeof player> | null;
  players?: ReturnType<typeof player>[];
  canAttachEquipment?: (playerId: string, card: GameCardInstance) => boolean;
  isAttachmentTarget?: (playerId: string, card: GameCardInstance) => boolean;
  isLandStacked?: (playerId: string, card: GameCardInstance) => boolean;
  manaSourceSuggestion?: (playerId: string, card: GameCardInstance) => ManaSourceSuggestion | null;
  isManaPoolHidden?: (playerId: string) => boolean;
  zoneCardCount?: (playerId: string, zone: GameZoneName) => number;
  ownedArrowCount?: number;
  activeDayNight?: boolean;
  monarchOwnerPlayerId?: string | null;
  initiativeOwnerPlayerId?: string | null;
  playerHasCitysBlessing?: (playerId: string) => boolean;
  playerHasTheRing?: (playerId: string) => boolean;
}

function createContextMenuFixture(menu: Partial<GameContextMenu>, options: ContextMenuFixtureOptions = {}) {
  const fixture = TestBed.createComponent(ContextMenuComponent);
  fixture.componentRef.setInput('menu', {
    x: 0,
    y: 0,
    playerId: 'user-1',
    zone: 'battlefield',
    kind: 'card',
    ...menu,
  } satisfies GameContextMenu);
  fixture.componentRef.setInput('currentPlayer', options.currentPlayer ?? null);
  fixture.componentRef.setInput('isGameOwner', false);
  fixture.componentRef.setInput('players', options.players ?? [
    player('user-1', 'User'),
    player('user-2', 'Opponent'),
  ]);
  fixture.componentRef.setInput('counterPresets', ['-1/-1', '+1/+1', 'red', 'green', 'blue', 'black', 'yellow']);
  fixture.componentRef.setInput('moveZones', ['battlefield', 'graveyard', 'exile', 'hand', 'command', 'library'] satisfies GameZoneName[]);
  fixture.componentRef.setInput('isCurrentPlayer', (playerId: string) => playerId === 'user-1');
  fixture.componentRef.setInput('canControlPlayer', options.canControlPlayer ?? ((playerId: string) => playerId === 'user-1'));
  fixture.componentRef.setInput('zoneCardCount', options.zoneCardCount ?? (() => 1));
  fixture.componentRef.setInput('shouldShowPowerToughness', (target: GameCardInstance) => target.power !== null && target.power !== undefined && target.toughness !== null && target.toughness !== undefined);
  fixture.componentRef.setInput('isLandStacked', options.isLandStacked ?? (() => false));
  fixture.componentRef.setInput('isAttachmentTarget', options.isAttachmentTarget ?? (() => false));
  fixture.componentRef.setInput('canAttachEquipment', options.canAttachEquipment ?? (() => true));
  fixture.componentRef.setInput('manaSourceSuggestion', options.manaSourceSuggestion ?? (() => null));
  fixture.componentRef.setInput('isManaPoolHidden', options.isManaPoolHidden ?? (() => false));
  fixture.componentRef.setInput('zoneTitle', titleForZone);
  fixture.componentRef.setInput('ownedArrowCount', options.ownedArrowCount ?? 0);
  fixture.componentRef.setInput('activeDayNight', options.activeDayNight ?? false);
  fixture.componentRef.setInput('monarchOwnerPlayerId', options.monarchOwnerPlayerId ?? null);
  fixture.componentRef.setInput('initiativeOwnerPlayerId', options.initiativeOwnerPlayerId ?? null);
  fixture.componentRef.setInput('playerHasCitysBlessing', options.playerHasCitysBlessing ?? (() => false));
  fixture.componentRef.setInput('playerHasTheRing', options.playerHasTheRing ?? (() => false));
  fixture.detectChanges();

  return fixture;
}

function player(
  id: string,
  displayName: string,
  status: 'active' | 'conceded' = 'active',
  colorIdentity: readonly string[] = [],
) {
  return {
    id,
    state: {
      user: { id, email: `${id}@test`, displayName, roles: [] },
      status,
      colorIdentity,
      life: 40,
      zones: {
        library: [],
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
        command: [],
      },
      commanderDamage: {},
      counters: {},
    },
  };
}

function menuText(fixture: ComponentFixture<ContextMenuComponent>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

function buttonLabels(fixture: ComponentFixture<ContextMenuComponent>): string[] {
  return menuButtons(fixture)
    .map((button) => (button.textContent ?? '').trim().replace(/\s+/g, ' '));
}

function menuButtons(fixture: ComponentFixture<ContextMenuComponent>): HTMLButtonElement[] {
  return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
}

function mockMatchMedia(matches: boolean): () => void {
  const original = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  return () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: original,
    });
  };
}

function card(instanceId: string, oracleText = ''): GameCardInstance {
  return {
    instanceId,
    ownerId: 'user-1',
    controllerId: 'user-1',
    name: 'Sol Ring',
    typeLine: 'Artifact',
    oracleText,
    tapped: false,
    counters: {},
  };
}

function emblemCard(instanceId: string): GameCardInstance {
  return {
    ...card(instanceId),
    name: 'Emblem',
    typeLine: 'Emblem',
    layout: 'emblem',
    isToken: true,
  };
}

function dungeonCard(instanceId: string): GameCardInstance {
  return {
    ...card(instanceId),
    name: 'Dungeon',
    typeLine: 'Dungeon',
    layout: 'dungeon',
    isToken: true,
  };
}

function theRingCard(instanceId: string): GameCardInstance {
  return {
    ...card(instanceId),
    name: 'The Ring // The Ring Tempts You',
    typeLine: 'Emblem // Card',
    layout: 'double_faced_token',
    cardFaces: [
      {
        name: 'The Ring',
        manaCost: null,
        typeLine: 'Emblem',
        oracleText: null,
        power: null,
        toughness: null,
        loyalty: null,
        colors: [],
        imageUris: { normal: '/cards/the-ring.jpg' },
      },
      {
        name: 'The Ring Tempts You',
        manaCost: null,
        typeLine: 'Card',
        oracleText: null,
        power: null,
        toughness: null,
        loyalty: null,
        colors: [],
        imageUris: { normal: '/cards/the-ring-tempts-you.jpg' },
      },
    ],
  };
}

function titleForZone(zone: GameZoneName): string {
  const titles: Record<GameZoneName, string> = {
    library: 'Library',
    hand: 'Hand',
    battlefield: 'Battlefield',
    graveyard: 'Graveyard',
    exile: 'Exile',
    command: 'Command',
  };

  return titles[zone];
}
