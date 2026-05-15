import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import { GameContextMenu } from '../state/game-table-ui.state';
import { ContextMenuComponent } from './context-menu.component';

describe('ContextMenuComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContextMenuComponent],
    }).compileComponents();
  });

  it('hides player life actions when the current user cannot control that player', () => {
    const fixture = createContextMenuFixture({
      kind: 'player',
      playerId: 'opponent',
      zone: 'battlefield',
    }, {
      canControlPlayer: () => false,
    });

    expect(menuText(fixture)).toContain('Focus Player');
    expect(menuText(fixture)).not.toContain('Life -1');
    expect(menuText(fixture)).not.toContain('Life +1');
  });

  it('only shows valid move-all targets for non-empty zones', () => {
    const graveyardMenu = createContextMenuFixture({
      kind: 'zone',
      playerId: 'user-1',
      zone: 'graveyard',
    }, {
      zoneCardCount: () => 2,
    });

    expect(menuText(graveyardMenu)).toContain('Move All To Exile');
    expect(menuText(graveyardMenu)).not.toContain('Move All To Graveyard');

    const emptyExileMenu = createContextMenuFixture({
      kind: 'zone',
      playerId: 'user-1',
      zone: 'exile',
    }, {
      zoneCardCount: () => 0,
    });

    expect(menuText(emptyExileMenu)).not.toContain('Move All To Graveyard');
    expect(menuText(emptyExileMenu)).not.toContain('Move All To Exile');
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
    expect(text).toContain('Make A Token Copy');
    expect(text).toContain('Add To Stack');
    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'moveTo');
    fixture.detectChanges();
    expect(menuText(fixture)).toContain('Battlefield');
    expect(text).not.toContain('Tap / Untap');
    expect(text).not.toContain('Power/Toughness');
    expect(text).not.toContain('Move To Hand');
  });

  it('keeps battlefield card actions and omits moving to the current zone', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: card('card-1'),
    });
    const text = menuText(fixture);

    expect(text).toContain('Tap');
    expect(text).toContain('Turn Face Down');
    expect(text).toContain('Power/Toughness');
    expect(text).toContain('Counters');
    fixture.componentInstance.toggleSubmenu(new MouseEvent('click'), 'counters');
    fixture.detectChanges();
    const countersText = menuText(fixture);
    expect(countersText).toContain('+1/+1');
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
    expect(commanderText).toContain('Turn Face Up');
    expect(commanderText).toContain('Command');

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
      .find((candidate) => candidate.textContent?.includes('Remove Power/Toughness'));
    button?.click();

    expect(menuText(fixture)).toContain('Remove Power/Toughness');
    expect(selected).toHaveBeenCalledWith({ type: 'clearPowerToughness' });
  });

  it('does not show manual power toughness removal when backend defaults exist', () => {
    const fixture = createContextMenuFixture({
      kind: 'card',
      playerId: 'user-1',
      zone: 'battlefield',
      card: { ...card('creature-1'), power: 2, toughness: 2, defaultPower: 2, defaultToughness: 2 },
    });

    expect(menuText(fixture)).not.toContain('Remove Power/Toughness');
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
      .find((candidate) => candidate.textContent?.includes('Delete Arrow'));
    button?.click();

    expect(menuText(fixture)).toContain('Delete Arrow');
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
      .find((candidate) => candidate.textContent?.includes('Delete Arrows'));
    button?.click();

    expect(menuText(fixture)).toContain('Delete Arrow');
    expect(menuText(fixture)).toContain('Delete Arrows');
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
      .find((candidate) => candidate.textContent?.includes('Delete Counter'));
    button?.click();

    expect(menuText(fixture)).toContain('Delete Counter');
    expect(selected).toHaveBeenCalledWith({ type: 'deleteCounter' });
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
    expect(text).toContain('Remove Red');
    expect(text).toContain('Remove Green');
    expect(text).toContain('Remove All Counters');

    const removeRed = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.includes('Remove Red'));
    removeRed?.click();

    expect(selected).toHaveBeenCalledWith({ type: 'removeCounter', counter: 'red' });
  });
});

interface ContextMenuFixtureOptions {
  canControlPlayer?: (playerId: string) => boolean;
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
  fixture.componentRef.setInput('currentPlayer', null);
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
  fixture.componentRef.setInput('zoneTitle', titleForZone);
  fixture.componentRef.setInput('ownedArrowCount', options.ownedArrowCount ?? 0);
  fixture.detectChanges();

  return fixture;
}

function player(id: string, displayName: string) {
  return {
    id,
    state: {
      user: { id, email: `${id}@test`, displayName, roles: [] },
      status: 'active',
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
