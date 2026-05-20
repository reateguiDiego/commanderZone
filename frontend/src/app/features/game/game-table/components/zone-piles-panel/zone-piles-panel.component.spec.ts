import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { ZonePilesPanelComponent } from './zone-piles-panel.component';

describe('ZonePilesPanelComponent', () => {
  it('exposes the zone dock and each pile as motion zones', async () => {
    const fixture = await renderZonePilesPanel();

    const dock = fixture.nativeElement.querySelector('[data-testid="zone-piles"]') as HTMLElement;

    expect(dock.dataset['motionZone']).toBe('player-1:zones');
    expect(zoneElement(fixture, 'library').dataset['motionZone']).toBe('player-1:library');
    expect(zoneElement(fixture, 'command').dataset['motionZone']).toBe('player-1:command');
    expect(zoneElement(fixture, 'graveyard').dataset['motionZone']).toBe('player-1:graveyard');
    expect(zoneElement(fixture, 'exile').dataset['motionZone']).toBe('player-1:exile');
  });

  it('exposes the top draggable pile card as a motion origin', async () => {
    const graveyardCard = card('graveyard-1', 'Top Graveyard Card', 'graveyard');
    const fixture = await renderZonePilesPanel({
      graveyard: [graveyardCard],
      topDraggableCard: (_player, zone) => zone === 'graveyard' ? graveyardCard : null,
    });

    expect(zoneElement(fixture, 'graveyard').dataset['motionOriginCardId']).toBe('graveyard-1');
    expect(zoneElement(fixture, 'library').dataset['motionOriginCardId']).toBeUndefined();
  });

  it('marks a zone stack while drop feedback is active', async () => {
    const fixture = await renderZonePilesPanel({
      isZoneDropSettling: (_playerId, zone) => zone === 'graveyard',
    });

    const graveyard = zoneElement(fixture, 'graveyard');
    const library = zoneElement(fixture, 'library');

    expect(graveyard.classList).toContain('drop-settling');
    expect(library.classList).not.toContain('drop-settling');
  });

  it('marks a source zone while a transfer is pending without removing its visible contents', async () => {
    const fixture = await renderZonePilesPanel({
      isZoneTransferPending: (_playerId, zone) => zone === 'graveyard',
    });

    const graveyard = zoneElement(fixture, 'graveyard');
    expect(graveyard.classList).toContain('transfer-pending');
    expect(graveyard.querySelector('[data-testid="zone-count"]')?.textContent?.trim()).toBe('1');
    expect(zoneElement(fixture, 'exile').classList).not.toContain('transfer-pending');
  });

  it('emits a large-card preview when hovering the command zone art', async () => {
    const commander = card('commander-1', 'Smeagol, Helpful Guide', 'command');
    const fixture = await renderZonePilesPanel({
      command: [commander],
      zonePreviewImage: (_player, zone) => zone === 'command' ? '/assets/commander.jpg' : null,
      zonePreviewCard: (_player, zone) => zone === 'command' ? commander : null,
    });
    const previewSpy = vi.fn();
    const hiddenSpy = vi.fn();
    fixture.componentInstance.cardPreviewShown.subscribe(previewSpy);
    fixture.componentInstance.cardPreviewHidden.subscribe(hiddenSpy);

    const zoneArt = zoneElement(fixture, 'command').querySelector('[data-testid="zone"]')!;
    zoneArt.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    zoneArt.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    expect(previewSpy).toHaveBeenCalledWith({ card: commander, playerId: 'player-1', zone: 'command', sourceRect: null });
    expect(hiddenSpy).toHaveBeenCalled();
  });

  it('emits a large-card preview when hovering a revealed library top card', async () => {
    const topCard = card('library-1', 'Revealed Top', 'library');
    const fixture = await renderZonePilesPanel({
      library: [topCard],
      zonePreviewImage: (_player, zone) => zone === 'library' ? '/assets/library-top.jpg' : null,
      zonePreviewCard: (_player, zone) => zone === 'library' ? topCard : null,
    });
    const previewSpy = vi.fn();
    const hiddenSpy = vi.fn();
    fixture.componentInstance.cardPreviewShown.subscribe(previewSpy);
    fixture.componentInstance.cardPreviewHidden.subscribe(hiddenSpy);

    const zoneArt = zoneElement(fixture, 'library').querySelector('[data-testid="zone"]')!;
    zoneArt.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    zoneArt.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    expect(previewSpy).toHaveBeenCalledWith({ card: topCard, playerId: 'player-1', zone: 'library', sourceRect: null });
    expect(hiddenSpy).toHaveBeenCalled();
  });

  it('emits a large-card preview when hovering the visible graveyard and exile cards', async () => {
    const graveyardTopCard = card('graveyard-2', 'Top Graveyard Card', 'graveyard');
    const exileTopCard = card('exile-2', 'Top Exile Card', 'exile');
    const fixture = await renderZonePilesPanel({
      graveyard: [
        card('graveyard-1', 'First Graveyard Card', 'graveyard'),
        graveyardTopCard,
      ],
      exile: [
        card('exile-1', 'First Exile Card', 'exile'),
        exileTopCard,
      ],
      zonePreviewImage: (_player, zone) => {
        if (zone === 'graveyard') {
          return '/assets/graveyard-top.jpg';
        }
        if (zone === 'exile') {
          return '/assets/exile-top.jpg';
        }
        return null;
      },
      zonePreviewCard: (_player, zone) => {
        if (zone === 'graveyard') {
          return graveyardTopCard;
        }
        if (zone === 'exile') {
          return exileTopCard;
        }
        return null;
      },
    });
    const previewSpy = vi.fn();
    const hiddenSpy = vi.fn();
    fixture.componentInstance.cardPreviewShown.subscribe(previewSpy);
    fixture.componentInstance.cardPreviewHidden.subscribe(hiddenSpy);

    const graveyardZoneArt = zoneElement(fixture, 'graveyard').querySelector('[data-testid="zone"]')!;
    const exileZoneArt = zoneElement(fixture, 'exile').querySelector('[data-testid="zone"]')!;
    graveyardZoneArt.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    graveyardZoneArt.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    exileZoneArt.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    exileZoneArt.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    expect(previewSpy).toHaveBeenCalledWith({ card: graveyardTopCard, playerId: 'player-1', zone: 'graveyard', sourceRect: null });
    expect(previewSpy).toHaveBeenCalledWith({ card: exileTopCard, playerId: 'player-1', zone: 'exile', sourceRect: null });
    expect(hiddenSpy).toHaveBeenCalledTimes(2);
  });

  it('does not open the command zone on left click', async () => {
    const fixture = await renderZonePilesPanel({
      command: [card('commander-1', 'Smeagol, Helpful Guide', 'command')],
    });
    const openedSpy = vi.fn();
    fixture.componentInstance.zoneOpened.subscribe(openedSpy);

    zoneElement(fixture, 'command').click();
    zoneElement(fixture, 'graveyard').click();

    expect(openedSpy).toHaveBeenCalledOnce();
    expect(openedSpy).toHaveBeenCalledWith({ playerId: 'player-1', zone: 'graveyard' });
  });

  it('renders library stack layers with the second-card image when the library has multiple cards', async () => {
    const fixture = await renderZonePilesPanel({
      library: [
        card('library-1', 'Top Card', 'library'),
        card('library-2', 'Second Card', 'library'),
        card('library-3', 'Third Card', 'library'),
      ],
      zonePreviewImage: (_player, zone) => zone === 'library' ? '/assets/library-top.jpg' : null,
      zoneStackLayerImage: (_player, zone) => zone === 'library' ? '/assets/library-second.jpg' : null,
    });

    const library = zoneElement(fixture, 'library');
    const layers = Array.from(library.querySelectorAll<HTMLImageElement>('.zone-card-stack-layer'));
    const topImage = library.querySelector<HTMLImageElement>('.zone-card-stack-top');

    expect(layers.length).toBe(2);
    expect(layers.every((layer) => layer.getAttribute('src') === '/assets/library-second.jpg')).toBe(true);
    expect(topImage?.getAttribute('src')).toBe('/assets/library-top.jpg');
    expect(library.querySelector('[data-testid="zone"]')?.classList).toContain('card-stack');
  });

  it('does not render stack layers when a pile has only one card', async () => {
    const fixture = await renderZonePilesPanel({
      library: [card('library-1', 'Top Card', 'library')],
      zonePreviewImage: (_player, zone) => zone === 'library' ? '/assets/library-top.jpg' : null,
      zoneStackLayerImage: () => null,
    });

    const library = zoneElement(fixture, 'library');

    expect(library.querySelectorAll('.zone-card-stack-layer').length).toBe(0);
    expect(library.querySelector<HTMLImageElement>('.zone-card-stack-top')?.getAttribute('src')).toBe('/assets/library-top.jpg');
  });

  it('uses second-card stack layers for visible graveyard and exile piles', async () => {
    const fixture = await renderZonePilesPanel({
      graveyard: [
        card('graveyard-1', 'First Graveyard Card', 'graveyard'),
        card('graveyard-2', 'Top Graveyard Card', 'graveyard'),
      ],
      exile: [
        card('exile-1', 'First Exile Card', 'exile'),
        card('exile-2', 'Second Exile Card', 'exile'),
        card('exile-3', 'Top Exile Card', 'exile'),
      ],
      zonePreviewImage: (_player, zone) => {
        if (zone === 'graveyard') {
          return '/assets/graveyard-top.jpg';
        }
        if (zone === 'exile') {
          return '/assets/exile-top.jpg';
        }
        return null;
      },
      zoneStackLayerImage: (_player, zone) => {
        if (zone === 'graveyard') {
          return '/assets/graveyard-second.jpg';
        }
        if (zone === 'exile') {
          return '/assets/exile-second.jpg';
        }
        return null;
      },
    });

    const graveyard = zoneElement(fixture, 'graveyard');
    const exile = zoneElement(fixture, 'exile');

    expect(graveyard.querySelectorAll('.zone-card-stack-layer').length).toBe(1);
    expect(exile.querySelectorAll('.zone-card-stack-layer').length).toBe(2);
    expect(graveyard.querySelector<HTMLImageElement>('.zone-card-stack-layer')?.getAttribute('src')).toBe('/assets/graveyard-second.jpg');
    expect(exile.querySelector<HTMLImageElement>('.zone-card-stack-layer')?.getAttribute('src')).toBe('/assets/exile-second.jpg');
    expect(graveyard.querySelector<HTMLImageElement>('.zone-card-stack-top')?.getAttribute('src')).toBe('/assets/graveyard-top.jpg');
    expect(exile.querySelector<HTMLImageElement>('.zone-card-stack-top')?.getAttribute('src')).toBe('/assets/exile-top.jpg');
  });

  it('marks the source pile while its top card is being dragged', async () => {
    const graveyardCard = card('graveyard-1', 'Top Graveyard Card', 'graveyard');
    const fixture = await renderZonePilesPanel({
      graveyard: [graveyardCard],
      currentDraggingCardInstanceId: graveyardCard.instanceId,
      topDraggableCard: (_player, zone) => zone === 'graveyard' ? graveyardCard : null,
      zonePreviewImage: (_player, zone) => zone === 'graveyard' ? '/assets/graveyard-top.jpg' : null,
    });

    expect(zoneElement(fixture, 'graveyard').classList).toContain('dragging-zone-card');
    expect(zoneElement(fixture, 'exile').classList).not.toContain('dragging-zone-card');
  });

  it('marks the source pile immediately when native drag starts', async () => {
    const graveyardCard = card('graveyard-1', 'Top Graveyard Card', 'graveyard');
    const fixture = await renderZonePilesPanel({
      graveyard: [graveyardCard],
      topDraggableCard: (_player, zone) => zone === 'graveyard' ? graveyardCard : null,
      zonePreviewImage: (_player, zone) => zone === 'graveyard' ? '/assets/graveyard-top.jpg' : null,
    });

    const graveyard = zoneElement(fixture, 'graveyard');
    graveyard.dispatchEvent(new Event('dragstart', { bubbles: true }));

    expect(graveyard.classList).toContain('dragging-zone-card');

    graveyard.dispatchEvent(new Event('dragend', { bubbles: true }));
    fixture.detectChanges();

    expect(graveyard.classList).not.toContain('dragging-zone-card');
  });
});

interface RenderZonePilesPanelOptions {
  isZoneDropSettling?: (playerId: string, zone: GameZoneName) => boolean;
  isZoneTransferPending?: (playerId: string, zone: GameZoneName) => boolean;
  library?: GameCardInstance[];
  command?: GameCardInstance[];
  graveyard?: GameCardInstance[];
  exile?: GameCardInstance[];
  currentDraggingCardInstanceId?: string | null;
  topDraggableCard?: (player: unknown, zone: GameZoneName) => GameCardInstance | null;
  zonePreviewCard?: (player: unknown, zone: GameZoneName) => GameCardInstance | null;
  zonePreviewImage?: (player: unknown, zone: GameZoneName) => string | null;
  zoneStackLayerImage?: (player: unknown, zone: GameZoneName) => string | null;
}

async function renderZonePilesPanel(options: RenderZonePilesPanelOptions = {}): Promise<ComponentFixture<ZonePilesPanelComponent>> {
  await TestBed.configureTestingModule({
    imports: [ZonePilesPanelComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(ZonePilesPanelComponent);
  const player = {
    id: 'player-1',
    state: {
      user: {
        id: 'user-1',
        email: 'player@example.com',
        displayName: 'Player',
        roles: [],
      },
      life: 40,
      zones: {
        library: options.library ?? [],
        hand: [],
        battlefield: [],
        graveyard: options.graveyard ?? [{ instanceId: 'card-1', name: 'Arcane Signet', tapped: false }],
        exile: options.exile ?? [],
        command: options.command ?? [],
      },
      zoneCounts: {
        library: options.library?.length ?? 0,
        hand: 0,
        battlefield: 0,
        graveyard: options.graveyard?.length ?? 1,
        exile: options.exile?.length ?? 0,
        command: options.command?.length ?? 0,
      },
      commanderDamage: {},
      counters: {},
    },
  };
  fixture.componentRef.setInput('player', player);
  fixture.componentRef.setInput('zones', ['library', 'command', 'graveyard', 'exile']);
  fixture.componentRef.setInput('colorAccent', () => '#f8f3df');
  fixture.componentRef.setInput('topDraggableCard', options.topDraggableCard ?? (() => null));
  fixture.componentRef.setInput('zonePreviewCard', options.zonePreviewCard ?? (() => null));
  fixture.componentRef.setInput('zoneCount', (_player: unknown, zone: GameZoneName) => player.state.zones[zone].length);
  fixture.componentRef.setInput('isDropZoneHighlighted', () => false);
  fixture.componentRef.setInput('zoneTitle', (zone: GameZoneName) => zone);
  fixture.componentRef.setInput('zonePreviewImage', options.zonePreviewImage ?? (() => null));
  fixture.componentRef.setInput('zoneStackLayerImage', options.zoneStackLayerImage ?? (() => null));
  fixture.componentRef.setInput('commanderCastCount', () => 0);
  fixture.componentRef.setInput('isZoneDropSettling', options.isZoneDropSettling ?? (() => false));
  fixture.componentRef.setInput('isZoneTransferPending', options.isZoneTransferPending ?? (() => false));
  fixture.componentRef.setInput('currentDraggingCardInstanceId', options.currentDraggingCardInstanceId ?? null);
  fixture.detectChanges();

  return fixture;
}

function zoneElement(fixture: ComponentFixture<ZonePilesPanelComponent>, zone: GameZoneName): HTMLElement {
  return fixture.nativeElement.querySelector(`[data-testid="drop-zone"][data-zone="${zone}"]`);
}

function card(instanceId: string, name: string, zone: GameZoneName): GameCardInstance {
  return {
    instanceId,
    name,
    zone,
    tapped: false,
  };
}
