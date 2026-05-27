import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  Ban,
  BarChart3,
  Biohazard,
  Bug,
  Copy,
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
          Copy,
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
      'Abrir debug',
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
      'Abrir debug',
      'Leave table',
    ]);
    expect(menuButtons(fixture)[3]?.classList).toContain('danger-menu-item');
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
      .find((item) => item.textContent?.includes('Abrir debug'));
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

    expect(buttonLabels(fixture)).toEqual(['Create token', 'Tirar dado']);
    expect(menuText(fixture)).not.toContain('View');
    expect(menuText(fixture)).not.toContain('Move all');

    const button = (fixture.nativeElement as HTMLElement).querySelector('button') as HTMLButtonElement;
    button.click();

    expect(selected).toHaveBeenCalledWith({ type: 'createToken' });

    const rollButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.includes('Tirar dado'));
    rollButton?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'rollDice' });
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
    expect(menuText(libraryMenu)).not.toContain('Make a token copy');
    expect(menuText(graveyardMenu)).toContain('Make a token copy');
    expect(menuText(graveyardMenu)).toContain('Select random card');
    expect(menuText(exileMenu)).toContain('Make a token copy');
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
    expect(text).toContain('Make a token copy');
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
    expect(revealText).toContain('Todos');
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
      'Draw card D',
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
    expect(menuText(fixture)).toContain('X to bottom of library');
    expect(menuText(fixture)).toContain('X to hand player');
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

    expect(menuText(stacked)).toContain('Remove stack');
    expect(menuText(loose)).not.toContain('Remove stack');
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
      .find((candidate) => candidate.textContent?.includes('Remove stack'));
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
      .find((image) => image.getAttribute('src')?.includes('/assets/icons/CZ/CZ_logo_zone_header.png'));
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
  canAttachEquipment?: (playerId: string, card: GameCardInstance) => boolean;
  isAttachmentTarget?: (playerId: string, card: GameCardInstance) => boolean;
  isLandStacked?: (playerId: string, card: GameCardInstance) => boolean;
  zoneCardCount?: (playerId: string, zone: GameZoneName) => number;
  ownedArrowCount?: number;
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
  fixture.componentRef.setInput('players', [
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
  fixture.componentRef.setInput('zoneTitle', titleForZone);
  fixture.componentRef.setInput('ownedArrowCount', options.ownedArrowCount ?? 0);
  fixture.detectChanges();

  return fixture;
}

function player(id: string, displayName: string, status: 'active' | 'conceded' = 'active') {
  return {
    id,
    state: {
      user: { id, email: `${id}@test`, displayName, roles: [] },
      status,
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

function card(instanceId: string): GameCardInstance {
  return {
    instanceId,
    ownerId: 'user-1',
    controllerId: 'user-1',
    name: 'Sol Ring',
    typeLine: 'Artifact',
    tapped: false,
    counters: {},
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
