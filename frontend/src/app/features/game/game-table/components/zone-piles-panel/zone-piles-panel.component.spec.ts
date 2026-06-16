import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Circle, Crown, Flag, Library, LucideAngularModule, Sparkles } from 'lucide-angular';
import { GameCardInstance, GameSpecialEntity, GameZoneName } from '../../../../../core/models/game.model';
import { GameTableSpecialEntitiesState } from '../../state/helpers/game-table-special-entities.state';
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
      cardImage: (inputCard) => inputCard.instanceId === commander.instanceId ? '/assets/commander.jpg' : null,
      zonePreviewCard: (_player, zone) => zone === 'command' ? commander : null,
    });
    const previewSpy = vi.fn();
    const hiddenSpy = vi.fn();
    fixture.componentInstance.cardPreviewShown.subscribe(previewSpy);
    fixture.componentInstance.cardPreviewHidden.subscribe(hiddenSpy);

    const commandCard = zoneElement(fixture, 'command').querySelector('[data-testid="command-zone-card"]')!;
    expect(zoneElement(fixture, 'command').querySelector('[data-testid="commanders-stack"]')).toBeNull();
    expect(commandCard.classList).toContain('single-command-zone-card');
    commandCard.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    commandCard.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    expect(previewSpy).toHaveBeenCalledWith({ card: commander, playerId: 'player-1', zone: 'command', sourceRect: null });
    expect(hiddenSpy).toHaveBeenCalled();
  });

  it('shows a monarch crown centered over the library', async () => {
    const fixture = await renderZonePilesPanel({
      specialEntities: [
        helperEntity('monarch', 'player-1'),
      ],
    });

    const crown = zoneElement(fixture, 'library').querySelector('.zone-monarch-badge') as HTMLElement | null;

    expect(crown).not.toBeNull();
    expect(crown?.getAttribute('title')).toBe('You are the monarch.');
    expect(zoneElement(fixture, 'graveyard').querySelector('.zone-monarch-badge')).toBeNull();
  });

  it('renders both command zone commanders with independent cast counters', async () => {
    const firstCommander = card('commander-1', 'Rograkh', 'command');
    const secondCommander = card('commander-2', 'Silas Renn', 'command');
    const fixture = await renderZonePilesPanel({
      command: [firstCommander, secondCommander],
      cardImage: (inputCard) => `/assets/${inputCard.instanceId}.jpg`,
      commanderCastCount: (_player, inputCommander) => inputCommander.instanceId === secondCommander.instanceId ? 2 : 0,
    });
    const castSpy = vi.fn();
    fixture.componentInstance.commanderCastChanged.subscribe(castSpy);

    const commandCards = Array.from(zoneElement(fixture, 'command').querySelectorAll<HTMLElement>('[data-testid="command-zone-card"]'));
    const castCounters = Array.from(zoneElement(fixture, 'command').querySelectorAll<HTMLElement>('[data-testid="commander-cast-count"]'));
    castCounters[1]!.click();

    expect(zoneElement(fixture, 'command').querySelector('[data-testid="commanders-stack"]')).not.toBeNull();
    expect(zoneElement(fixture, 'command').querySelector('[data-testid="zone"]')?.classList).toContain('dual-command-zone-art');
    expect(commandCards.map((element) => element.dataset['cardId'])).toEqual(['commander-1', 'commander-2']);
    expect(commandCards.map((element) => element.querySelector('img')?.getAttribute('src'))).toEqual(['/assets/commander-1.jpg', '/assets/commander-2.jpg']);
    expect(castCounters.map((element) => element.textContent?.trim())).toEqual(['0', '2']);
    expect(castCounters.map((element) => element.tagName)).toEqual(['STRONG', 'STRONG']);
    expect(castCounters.map((element) => element.classList.contains('active'))).toEqual([true, true]);
    expect(castCounters.map((element) => element.getAttribute('title'))).toEqual(['Rograkh', 'Silas Renn']);
    expect(castSpy).toHaveBeenCalledWith({ playerId: 'player-1', commanderInstanceId: 'commander-2', delta: 1 });
  });

  it('keeps commander cast counters visible when a commander leaves the command zone', async () => {
    const commandZoneCommander = { ...card('commander-1', 'Rograkh', 'command'), isCommander: true };
    const battlefieldCommander = { ...card('commander-2', 'Silas Renn', 'battlefield'), isCommander: true };
    const fixture = await renderZonePilesPanel({
      command: [commandZoneCommander],
      commanderCards: () => [commandZoneCommander, battlefieldCommander],
      commanderCastCount: (_player, inputCommander) => inputCommander.instanceId === battlefieldCommander.instanceId ? 3 : 1,
    });
    const castSpy = vi.fn();
    fixture.componentInstance.commanderCastChanged.subscribe(castSpy);

    const commandCards = Array.from(zoneElement(fixture, 'command').querySelectorAll<HTMLElement>('[data-testid="command-zone-card"]'));
    const castCounters = Array.from(zoneElement(fixture, 'command').querySelectorAll<HTMLElement>('[data-testid="commander-cast-count"]'));
    castCounters[1]!.click();

    expect(zoneElement(fixture, 'command').querySelector('[data-testid="commanders-stack"]')).toBeNull();
    expect(commandCards.map((element) => element.dataset['cardId'])).toEqual(['commander-1']);
    expect(castCounters.map((element) => element.dataset['cardId'])).toEqual(['commander-1', 'commander-2']);
    expect(castCounters.map((element) => element.textContent?.trim())).toEqual(['1', '3']);
    expect(castSpy).toHaveBeenCalledWith({ playerId: 'player-1', commanderInstanceId: 'commander-2', delta: 1 });
  });

  it('keeps command stack cast counters visible when a commander is pending transfer', async () => {
    const firstCommander = card('commander-1', 'Rograkh', 'command');
    const secondCommander = card('commander-2', 'Silas Renn', 'command');
    const fixture = await renderZonePilesPanel({
      command: [firstCommander, secondCommander],
      cardImage: (inputCard) => `/assets/${inputCard.instanceId}.jpg`,
      isCardTransferPending: (_playerId, zone, inputCard) => zone === 'command' && inputCard.instanceId === secondCommander.instanceId,
    });

    const commandCards = Array.from(zoneElement(fixture, 'command').querySelectorAll<HTMLElement>('[data-testid="command-zone-card"]'));
    const castCounters = Array.from(zoneElement(fixture, 'command').querySelectorAll<HTMLElement>('[data-testid="commander-cast-count"]'));

    expect(commandCards[0]!.classList).not.toContain('transfer-pending-command-zone-card');
    expect(commandCards[1]!.classList).toContain('transfer-pending-command-zone-card');
    expect(castCounters.map((element) => element.dataset['cardId'])).toEqual(['commander-1', 'commander-2']);
  });

  it('starts pointer drags from the selected command zone commander', async () => {
    const firstCommander = card('commander-1', 'Rograkh', 'command');
    const secondCommander = card('commander-2', 'Silas Renn', 'command');
    const fixture = await renderZonePilesPanel({
      command: [firstCommander, secondCommander],
      cardImage: (inputCard) => `/assets/${inputCard.instanceId}.jpg`,
    });
    const started = vi.fn();
    fixture.componentInstance.zonePointerDragStarted.subscribe(started);
    const commandCards = Array.from(zoneElement(fixture, 'command').querySelectorAll<HTMLElement>('[data-testid="command-zone-card"]'));
    stubElementRect(commandCards[1]!);
    const battlefield = document.createElement('div');
    battlefield.dataset['gameDropZone'] = 'battlefield';
    battlefield.dataset['zone'] = 'battlefield';
    battlefield.dataset['playerId'] = 'player-1';
    const restore = mockElementsFromPoint([battlefield]);

    fixture.componentInstance.startZonePointerDrag(pointerEvent({
      currentTarget: commandCards[1]!,
      pointerType: 'touch',
      pointerId: 17,
      clientX: 20,
      clientY: 20,
    }), 'command', secondCommander);
    fixture.componentInstance.moveZonePointerDrag(pointerEvent({
      pointerType: 'touch',
      pointerId: 17,
      clientX: 80,
      clientY: 20,
    }));
    fixture.detectChanges();

    expect(started).toHaveBeenCalledWith({ playerId: 'player-1', zone: 'command', card: secondCommander });
    expect(fixture.nativeElement.querySelector('.zone-floating-card img')?.getAttribute('src')).toBe('/assets/commander-2.jpg');
    expect(commandCards[0]!.classList).not.toContain('dragging-command-zone-card');
    expect(commandCards[1]!.classList).toContain('dragging-command-zone-card');

    restore();
  });

  it('starts mouse pointer drags from the selected command stack commander', async () => {
    const firstCommander = card('commander-1', 'Rograkh', 'command');
    const secondCommander = card('commander-2', 'Silas Renn', 'command');
    const fixture = await renderZonePilesPanel({
      command: [firstCommander, secondCommander],
      cardImage: (inputCard) => `/assets/${inputCard.instanceId}.jpg`,
    });
    const started = vi.fn();
    const targetChanged = vi.fn();
    fixture.componentInstance.zonePointerDragStarted.subscribe(started);
    fixture.componentInstance.zonePointerDropTargetChanged.subscribe(targetChanged);
    const commandCards = Array.from(zoneElement(fixture, 'command').querySelectorAll<HTMLElement>('[data-testid="command-zone-card"]'));
    stubElementRect(commandCards[1]!);
    const exile = document.createElement('button');
    exile.dataset['gameDropZone'] = 'exile';
    exile.dataset['zone'] = 'exile';
    exile.dataset['playerId'] = 'player-1';
    const restore = mockElementsFromPoint([exile]);

    fixture.componentInstance.startZonePointerDrag(pointerEvent({
      currentTarget: commandCards[1]!,
      pointerType: 'mouse',
      pointerId: 18,
      clientX: 20,
      clientY: 20,
    }), 'command', secondCommander, true);
    fixture.componentInstance.moveZonePointerDrag(pointerEvent({
      pointerType: 'mouse',
      pointerId: 18,
      clientX: 80,
      clientY: 20,
    }));
    fixture.detectChanges();

    expect(commandCards[1]!.getAttribute('draggable')).toBe('false');
    expect(started).toHaveBeenCalledWith({ playerId: 'player-1', zone: 'command', card: secondCommander });
    expect(targetChanged).toHaveBeenCalledWith(expect.objectContaining({
      targetPlayerId: 'player-1',
      toZone: 'exile',
      draggedInstanceId: 'commander-2',
    }));
    expect(fixture.nativeElement.querySelector('.zone-floating-card img')?.getAttribute('src')).toBe('/assets/commander-2.jpg');
    expect(commandCards[0]!.classList).not.toContain('dragging-command-zone-card');
    expect(commandCards[1]!.classList).toContain('dragging-command-zone-card');

    restore();
  });

  it('starts native drags from the selected command stack commander and hides only that origin card', async () => {
    const firstCommander = card('commander-1', 'Rograkh', 'command');
    const secondCommander = card('commander-2', 'Silas Renn', 'command');
    const fixture = await renderZonePilesPanel({
      command: [firstCommander, secondCommander],
      cardImage: (inputCard) => `/assets/${inputCard.instanceId}.jpg`,
    });
    const started = vi.fn();
    fixture.componentInstance.zoneDragStart.subscribe(started);
    const commandCards = Array.from(zoneElement(fixture, 'command').querySelectorAll<HTMLElement>('[data-testid="command-zone-card"]'));

    commandCards[1]!.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(started).toHaveBeenCalledWith({
      event: expect.any(Event),
      player: expect.objectContaining({ id: 'player-1' }),
      zone: 'command',
      card: secondCommander,
    });
    expect(commandCards[0]!.classList).not.toContain('dragging-command-zone-card');
    expect(commandCards[1]!.classList).toContain('dragging-command-zone-card');
  });

  it('does not start command stack drags for players you cannot control', async () => {
    const firstCommander = card('commander-1', 'Rograkh', 'command');
    const secondCommander = card('commander-2', 'Silas Renn', 'command');
    const fixture = await renderZonePilesPanel({
      command: [firstCommander, secondCommander],
      canControlPlayer: () => false,
    });
    const pointerStarted = vi.fn();
    const nativeStarted = vi.fn();
    fixture.componentInstance.zonePointerDragStarted.subscribe(pointerStarted);
    fixture.componentInstance.zoneDragStart.subscribe(nativeStarted);
    const commandCards = Array.from(zoneElement(fixture, 'command').querySelectorAll<HTMLElement>('[data-testid="command-zone-card"]'));
    stubElementRect(commandCards[1]!);

    commandCards[1]!.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      pointerType: 'mouse',
      pointerId: 21,
      clientX: 20,
      clientY: 20,
    }));
    fixture.componentInstance.moveZonePointerDrag(pointerEvent({
      pointerType: 'mouse',
      pointerId: 21,
      clientX: 80,
      clientY: 20,
    }));
    commandCards[1]!.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(pointerStarted).not.toHaveBeenCalled();
    expect(nativeStarted).not.toHaveBeenCalled();
    expect(commandCards[1]!.getAttribute('draggable')).toBeNull();
    expect(commandCards[1]!.classList).not.toContain('dragging-command-zone-card');
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

  it('marks the source pile immediately when native library drag starts', async () => {
    const libraryCard = card('library-1', 'Top Library Card', 'library');
    const fixture = await renderZonePilesPanel({
      library: [libraryCard],
      topDraggableCard: (_player, zone) => zone === 'library' ? libraryCard : null,
      zonePreviewImage: (_player, zone) => zone === 'library' ? '/assets/library-top.jpg' : null,
    });

    const library = zoneElement(fixture, 'library');
    library.dispatchEvent(new Event('dragstart', { bubbles: true }));

    expect(library.classList).toContain('dragging-zone-card');

    library.dispatchEvent(new Event('dragend', { bubbles: true }));
    fixture.detectChanges();

    expect(library.classList).not.toContain('dragging-zone-card');
  });

  it.each(['graveyard', 'exile'] as const)(
    'uses mouse pointer drags for public pile commanders from %s so they can target command zone',
    async (zone) => {
      const pileCard = { ...card('pile-1', 'Pile Card', zone), isCommander: true };
      const fixture = await renderZonePilesPanel({
        [zone]: [pileCard],
        topDraggableCard: (_player, candidateZone) => candidateZone === zone ? pileCard : null,
        zonePreviewImage: (_player, candidateZone) => candidateZone === zone ? '/assets/pile-card.jpg' : null,
      });
      const started = vi.fn();
      const targetChanged = vi.fn();
      fixture.componentInstance.zonePointerDragStarted.subscribe(started);
      fixture.componentInstance.zonePointerDropTargetChanged.subscribe(targetChanged);
      const sourceZone = zoneElement(fixture, zone);
      const command = zoneElement(fixture, 'command');
      stubZoneArtRect(sourceZone);
      const restore = mockElementsFromPoint([command]);

      fixture.componentInstance.startZonePointerDrag(pointerEvent({
        currentTarget: sourceZone,
        pointerType: 'mouse',
        pointerId: 11,
        clientX: 20,
        clientY: 20,
      }), zone, pileCard, fixture.componentInstance.canUseMousePointerDrag(zone, pileCard));
      fixture.componentInstance.moveZonePointerDrag(pointerEvent({
        pointerType: 'mouse',
        pointerId: 11,
        clientX: 80,
        clientY: 20,
      }));
      fixture.detectChanges();

      expect(started).toHaveBeenCalledWith({ playerId: 'player-1', zone, card: pileCard });
      expect(targetChanged).toHaveBeenCalledWith({
        targetPlayerId: 'player-1',
        toZone: 'command',
        kind: 'zone',
        rawZone: 'command',
        draggedInstanceId: 'pile-1',
        pointerClient: { x: 80, y: 20 },
      });
      expect(sourceZone.getAttribute('draggable')).toBeNull();
      expect(sourceZone.classList).toContain('dragging-zone-card');
      expect(fixture.nativeElement.querySelector('.zone-floating-card img')?.getAttribute('src')).toBe('/assets/pile-card.jpg');

      restore();
    },
  );

  it('emits pointer drag events for touch drags and marks the source zone', async () => {
    const graveyardCard = card('graveyard-1', 'Top Graveyard Card', 'graveyard');
    const fixture = await renderZonePilesPanel({
      graveyard: [graveyardCard],
      topDraggableCard: (_player, zone) => zone === 'graveyard' ? graveyardCard : null,
      zonePreviewImage: (_player, zone) => zone === 'graveyard' ? '/assets/graveyard-top.jpg' : null,
    });
    const started = vi.fn();
    const targetChanged = vi.fn();
    fixture.componentInstance.zonePointerDragStarted.subscribe(started);
    fixture.componentInstance.zonePointerDropTargetChanged.subscribe(targetChanged);
    const graveyard = zoneElement(fixture, 'graveyard');
    stubZoneArtRect(graveyard);
    const exile = document.createElement('button');
    exile.dataset['gameDropZone'] = 'exile';
    exile.dataset['zone'] = 'exile';
    exile.dataset['playerId'] = 'player-1';
    const restore = mockElementsFromPoint([exile]);

    fixture.componentInstance.startZonePointerDrag(pointerEvent({
      currentTarget: graveyard,
      pointerType: 'touch',
      pointerId: 7,
      clientX: 20,
      clientY: 20,
    }), 'graveyard', graveyardCard);
    fixture.componentInstance.moveZonePointerDrag(pointerEvent({
      pointerType: 'touch',
      pointerId: 7,
      clientX: 80,
      clientY: 20,
    }));
    fixture.detectChanges();

    expect(started).toHaveBeenCalledWith({ playerId: 'player-1', zone: 'graveyard', card: graveyardCard });
    expect(targetChanged).toHaveBeenCalledWith({
      targetPlayerId: 'player-1',
      toZone: 'exile',
      kind: 'zone',
      rawZone: 'exile',
      draggedInstanceId: 'graveyard-1',
      pointerClient: { x: 80, y: 20 },
    });
    expect(graveyard.classList).toContain('dragging-zone-card');
    expect(fixture.nativeElement.querySelector('.zone-floating-card img')?.getAttribute('src')).toBe('/assets/graveyard-top.jpg');

    restore();
  });

  it('emits a pointer drop request and suppresses the follow-up click after touch drag', async () => {
    const graveyardCard = card('graveyard-1', 'Top Graveyard Card', 'graveyard');
    const fixture = await renderZonePilesPanel({
      graveyard: [graveyardCard],
      topDraggableCard: (_player, zone) => zone === 'graveyard' ? graveyardCard : null,
    });
    const dropped = vi.fn();
    const opened = vi.fn();
    fixture.componentInstance.zonePointerDropped.subscribe(dropped);
    fixture.componentInstance.zoneOpened.subscribe(opened);
    const graveyard = zoneElement(fixture, 'graveyard');
    stubZoneArtRect(graveyard);
    const hand = document.createElement('div');
    hand.dataset['gameDropZone'] = 'hand';
    hand.dataset['zone'] = 'hand';
    hand.dataset['playerId'] = 'player-1';
    const restore = mockElementsFromPoint([hand]);

    fixture.componentInstance.startZonePointerDrag(pointerEvent({
      currentTarget: graveyard,
      pointerType: 'touch',
      pointerId: 8,
      clientX: 20,
      clientY: 20,
    }), 'graveyard', graveyardCard);
    fixture.componentInstance.moveZonePointerDrag(pointerEvent({
      pointerType: 'touch',
      pointerId: 8,
      clientX: 20,
      clientY: 80,
    }));
    fixture.componentInstance.endZonePointerDrag(pointerEvent({
      pointerType: 'touch',
      pointerId: 8,
      clientX: 20,
      clientY: 80,
    }));
    fixture.detectChanges();
    graveyard.click();

    expect(dropped).toHaveBeenCalledWith({
      moved: true,
      request: {
        playerId: 'player-1',
        targetPlayerId: 'player-1',
        fromZone: 'graveyard',
        toZone: 'hand',
        instanceId: 'graveyard-1',
        rawZone: 'hand',
      },
    });
    expect(opened).not.toHaveBeenCalled();
    expect(graveyard.classList).not.toContain('dragging-zone-card');

    restore();
  });

  it('clears pointer drag visuals on pointer cancel', async () => {
    const graveyardCard = card('graveyard-1', 'Top Graveyard Card', 'graveyard');
    const fixture = await renderZonePilesPanel({
      graveyard: [graveyardCard],
      topDraggableCard: (_player, zone) => zone === 'graveyard' ? graveyardCard : null,
    });
    const ended = vi.fn();
    fixture.componentInstance.zonePointerDragEnded.subscribe(ended);
    const graveyard = zoneElement(fixture, 'graveyard');
    stubZoneArtRect(graveyard);

    fixture.componentInstance.startZonePointerDrag(pointerEvent({
      currentTarget: graveyard,
      pointerType: 'touch',
      pointerId: 9,
      clientX: 20,
      clientY: 20,
    }), 'graveyard', graveyardCard);
    fixture.componentInstance.moveZonePointerDrag(pointerEvent({
      pointerType: 'touch',
      pointerId: 9,
      clientX: 80,
      clientY: 20,
    }));
    fixture.detectChanges();
    fixture.componentInstance.cancelZonePointerDrag(pointerEvent({
      pointerType: 'touch',
      pointerId: 9,
      clientX: 80,
      clientY: 20,
    }));
    fixture.detectChanges();

    expect(ended).toHaveBeenCalled();
    expect(graveyard.classList).not.toContain('dragging-zone-card');
    expect(fixture.nativeElement.querySelector('.zone-floating-card')).toBeNull();
  });
});

interface RenderZonePilesPanelOptions {
  isZoneDropSettling?: (playerId: string, zone: GameZoneName) => boolean;
  isZoneTransferPending?: (playerId: string, zone: GameZoneName) => boolean;
  isCardTransferPending?: (playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean;
  library?: GameCardInstance[];
  command?: GameCardInstance[];
  graveyard?: GameCardInstance[];
  exile?: GameCardInstance[];
  currentDraggingCardInstanceId?: string | null;
  topDraggableCard?: (player: unknown, zone: GameZoneName) => GameCardInstance | null;
  zonePreviewCard?: (player: unknown, zone: GameZoneName) => GameCardInstance | null;
  zonePreviewImage?: (player: unknown, zone: GameZoneName) => string | null;
  zoneStackLayerImage?: (player: unknown, zone: GameZoneName) => string | null;
  commandZoneCards?: (player: unknown) => readonly GameCardInstance[];
  commanderCards?: (player: unknown) => readonly GameCardInstance[];
  cardImage?: (card: GameCardInstance) => string | null;
  commanderCastCount?: (player: unknown, commander: GameCardInstance) => number;
  specialEntities?: readonly GameSpecialEntity[];
  canControlPlayer?: (playerId: string) => boolean;
}

async function renderZonePilesPanel(options: RenderZonePilesPanelOptions = {}): Promise<ComponentFixture<ZonePilesPanelComponent>> {
  await TestBed.configureTestingModule({
    imports: [ZonePilesPanelComponent],
    providers: [
      importProvidersFrom(LucideAngularModule.pick({ Circle, Crown, Flag, Library, Sparkles })),
      {
        provide: GameTableSpecialEntitiesState,
        useValue: {
          globalEntity: (template: GameSpecialEntity['template']) =>
            (options.specialEntities ?? []).find((entity) => entity.template === template) ?? null,
        } satisfies Pick<GameTableSpecialEntitiesState, 'globalEntity'>,
      },
    ],
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
  fixture.componentRef.setInput('commandZoneCards', options.commandZoneCards ?? ((inputPlayer: unknown) => (inputPlayer as typeof player).state.zones.command));
  fixture.componentRef.setInput('commanderCards', options.commanderCards ?? options.commandZoneCards ?? ((inputPlayer: unknown) => (inputPlayer as typeof player).state.zones.command));
  fixture.componentRef.setInput('cardImage', options.cardImage ?? ((inputCard: GameCardInstance) => inputCard.imageUris?.['normal'] ?? null));
  fixture.componentRef.setInput('commanderCastCount', options.commanderCastCount ?? (() => 0));
  fixture.componentRef.setInput('canControlPlayer', options.canControlPlayer ?? (() => true));
  fixture.componentRef.setInput('isZoneDropSettling', options.isZoneDropSettling ?? (() => false));
  fixture.componentRef.setInput('isZoneTransferPending', options.isZoneTransferPending ?? (() => false));
  fixture.componentRef.setInput('isCardTransferPending', options.isCardTransferPending ?? (() => false));
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

function stubZoneArtRect(zone: HTMLElement): void {
  const zoneArt = zone.querySelector<HTMLElement>('.zone-art')!;
  stubElementRect(zoneArt);
}

function stubElementRect(element: HTMLElement): void {
  element.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    width: 100,
    height: 140,
    top: 0,
    right: 100,
    bottom: 140,
    left: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

function mockElementsFromPoint(elements: Element[]): () => void {
  const original = document.elementsFromPoint;
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: vi.fn(() => elements),
  });

  return () => {
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: original,
    });
  };
}

function pointerEvent(patch: Partial<PointerEvent> & { clientX: number; clientY: number }): PointerEvent {
  return {
    button: 0,
    pointerId: 1,
    pointerType: 'touch',
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...patch,
  } as unknown as PointerEvent;
}
