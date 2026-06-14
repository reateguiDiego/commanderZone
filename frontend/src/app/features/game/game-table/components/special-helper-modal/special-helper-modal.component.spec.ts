import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ArrowLeft, LucideAngularModule } from 'lucide-angular';
import { CARD_SEARCH_LIMIT, CardsApi } from '../../../../../core/api/cards.api';
import { SpecialHelperModalComponent } from './special-helper-modal.component';

describe('SpecialHelperModalComponent', () => {
  let fixture: ComponentFixture<SpecialHelperModalComponent>;
  let cardsApi: { search: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    cardsApi = {
      search: vi.fn(() => of({
        data: [{
          scryfallId: 'emblem-1',
          name: 'Gideon Emblem',
          typeLine: 'Emblem',
          imageUris: { normal: 'https://cards.example/emblem.jpg' },
          cardFaces: [],
        }],
        page: 1,
        limit: 36,
      })),
    };

    await TestBed.configureTestingModule({
      imports: [SpecialHelperModalComponent],
      providers: [
        { provide: CardsApi, useValue: cardsApi },
        importProvidersFrom(LucideAngularModule.pick({ ArrowLeft })),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SpecialHelperModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('playerName', 'User');
    fixture.detectChanges();
  });

  it('emits quick helper actions', () => {
    const selected = vi.fn();
    fixture.componentInstance.quickActionSelected.subscribe(selected);

    fixture.componentInstance.setQuickAction('monarch');

    expect(selected).toHaveBeenCalledWith('monarch');
  });

  it('searches card-backed helpers with the selected gameplayKind', async () => {
    vi.useFakeTimers();
    try {
      fixture.componentInstance.setSearchKind('dungeon');
      fixture.componentInstance.onQueryInput('under');
      await vi.advanceTimersByTimeAsync(320);
      fixture.detectChanges();

      expect(cardsApi.search).toHaveBeenCalledWith('under', 1, CARD_SEARCH_LIMIT, { gameplayKind: 'dungeon' });
      expect(fixture.componentInstance.searchResults()[0]?.name).toBe('Gideon Emblem');
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to the available helper catalog when a dungeon search has no direct matches', async () => {
    vi.useFakeTimers();
    try {
      cardsApi.search
        .mockReturnValueOnce(of({
          data: [],
          page: 1,
          limit: 36,
        }))
        .mockReturnValueOnce(of({
          data: [{
            scryfallId: 'dungeon-1',
            name: 'Undercity // The Initiative',
            typeLine: 'Dungeon — Undercity // Card',
            layout: 'double_faced_token',
            imageUris: { normal: 'https://cards.example/dungeon.jpg' },
            cardFaces: [],
          }],
          page: 1,
          limit: 36,
        }));

      fixture.componentInstance.setSearchKind('dungeon');
      fixture.componentInstance.onQueryInput('mazmorra');
      await vi.advanceTimersByTimeAsync(320);
      fixture.detectChanges();

      expect(cardsApi.search).toHaveBeenNthCalledWith(1, 'mazmorra', 1, CARD_SEARCH_LIMIT, { gameplayKind: 'dungeon' });
      expect(cardsApi.search).toHaveBeenNthCalledWith(2, '', 1, CARD_SEARCH_LIMIT, { gameplayKind: 'dungeon' });
      expect(fixture.componentInstance.searchResults()[0]?.name).toBe('Undercity // The Initiative');
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces the translated search error key when the helper search fails', async () => {
    vi.useFakeTimers();
    try {
      cardsApi.search.mockReturnValueOnce(throwError(() => new Error('boom')));

      fixture.componentInstance.onQueryInput('em');
      await vi.advanceTimersByTimeAsync(320);
      fixture.detectChanges();

      expect(fixture.componentInstance.errorKey()).toBe('game.specialHelpers.modal.searchError');
    } finally {
      vi.useRealTimers();
    }
  });

  it('exposes ring updates and removals from the mechanics state section', () => {
    fixture.componentRef.setInput('playerSummary', {
      playerId: 'user-1',
      monarch: null,
      initiative: null,
      citysBlessing: null,
      ring: {
        id: 'ring-1',
        template: 'the_ring',
        scope: 'player',
        ownerPlayerId: 'user-1',
        card: null,
        state: { level: 2, ringBearerInstanceId: 'card-1' },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      dungeon: null,
      emblems: [],
      displayEntities: [],
      hasAny: true,
    });
    fixture.componentRef.setInput('ringBearerName', () => 'Bilbo');
    fixture.detectChanges();

    const updated = vi.fn();
    const removed = vi.fn();
    fixture.componentInstance.entityUpdated.subscribe(updated);
    fixture.componentInstance.entityRemoved.subscribe(removed);

    fixture.componentInstance.increaseRingLevel();
    fixture.componentInstance.clearRingBearer();
    fixture.componentInstance.removeEntity(fixture.componentInstance.playerSummary!.ring!);

    expect(updated).toHaveBeenCalledWith({
      entityId: 'ring-1',
      state: { level: 3, ringBearerInstanceId: 'card-1' },
    });
    expect(updated).toHaveBeenCalledWith({
      entityId: 'ring-1',
      state: { level: 2, ringBearerInstanceId: null },
    });
    expect(removed).toHaveBeenCalledWith('ring-1');
  });

  it('stays read-only when opened for an uncontrolled player', () => {
    fixture.componentRef.setInput('interactionMode', 'readonly');
    fixture.detectChanges();

    const selected = vi.fn();
    fixture.componentInstance.quickActionSelected.subscribe(selected);
    fixture.componentInstance.setQuickAction('monarch');

    expect(fixture.nativeElement.textContent).toContain('Read-only');
    expect(selected).not.toHaveBeenCalled();
  });

  it('closes when the modal cancel action is pressed', () => {
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    const buttons = Array.from(fixture.nativeElement.querySelectorAll('footer button')) as HTMLButtonElement[];
    const cancelButton = buttons.find((button) => button.textContent?.trim() === 'Cancel');

    cancelButton?.click();

    expect(closed).toHaveBeenCalledOnce();
  });
});
