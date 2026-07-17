import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule, RotateCw, TriangleAlert, X } from 'lucide-angular';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { ZoneModalState } from '../../state/zones/game-table-zone-modal.state';
import { ZoneModalComponent } from './zone-modal.component';

describe('ZoneModalComponent View X', () => {
  let fixture: ComponentFixture<ZoneModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ZoneModalComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ RotateCw, TriangleAlert, X }))],
    }).compileComponents();
  });

  afterEach(() => {
    fixture?.destroy();
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  });

  it('renders a named modal dialog, locks body scroll and focuses the first card', async () => {
    fixture = createFixture(readyModal());

    const dialog = fixture.nativeElement.querySelector('[data-testid="zone-modal"]') as HTMLElement;
    await flushFocus();

    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('zone-modal-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('zone-modal-description');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement?.getAttribute('data-card-instance-id')).toBe('top');
  });

  it('moves initial focus from the opening fallback to the first card when loading becomes ready', async () => {
    const loading = readyModal({ lifecycle: 'loading', loading: true });
    fixture = createFixture(loading);
    await flushFocus();
    expect(document.activeElement).toBe(button('zone-modal-close'));

    fixture.componentRef.setInput('modal', { ...loading, lifecycle: 'ready', loading: false });
    fixture.detectChanges();
    await flushFocus();

    expect(document.activeElement?.getAttribute('data-card-instance-id')).toBe('top');
  });

  it('toggles locally by pointer and Space without contaminating the selected-card input', () => {
    fixture = createFixture(readyModal());
    const top = cardButton('top');
    const second = cardButton('second');

    top.click();
    second.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(selectedIds()).toEqual(['top', 'second']);
    expect(fixture.componentInstance.selection().selectionOrder).toEqual(['top', 'second']);
    expect(fixture.componentInstance.modal().selectedCardId).toBe('top');
  });

  it('selects a visual Shift range, Select All and Clear All without duplicates', () => {
    fixture = createFixture(readyModal());
    cardButton('top').click();
    cardButton('third').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.selection().selectionOrder).toEqual(['top', 'second', 'third']);

    button('zone-modal-select-all').click();
    fixture.detectChanges();
    expect(selectedIds()).toEqual(['top', 'second', 'third']);

    button('zone-modal-clear-all').click();
    fixture.detectChanges();
    expect(selectedIds()).toEqual([]);
  });

  it('keeps backdrop clicks inert, closes with Escape and restores focus to the trigger', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    fixture = createFixture(readyModal());
    const closed = vi.fn();
    fixture.componentInstance.close.subscribe(closed);

    const backdrop = fixture.nativeElement.querySelector('[data-testid="zone-modal-backdrop"]') as HTMLElement;
    backdrop.click();
    expect(closed).not.toHaveBeenCalled();

    const dialog = fixture.nativeElement.querySelector('[data-testid="zone-modal"]') as HTMLElement;
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(closed).toHaveBeenCalledOnce();

    fixture.destroy();
    await flushFocus();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe('');
    trigger.remove();
  });

  it('traps Tab focus inside the dialog', () => {
    fixture = createFixture(readyModal());
    const host = fixture.nativeElement as HTMLElement;
    const focusable = Array.from(host.querySelectorAll<HTMLElement>('button, [tabindex]'));
    for (const element of focusable) {
      Object.defineProperty(element, 'offsetParent', { configurable: true, get: () => element.parentElement });
    }
    const cards = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-card-instance-id]'));
    const close = button('zone-modal-close');
    const last = cards.at(-1) as HTMLButtonElement;
    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));

    expect(document.activeElement).toBe(close);
  });

  it('isolates reorder mode from multi-selection and clears local selection on mode changes', () => {
    fixture = createFixture(readyModal({ allowReorder: true }));
    cardButton('top').click();
    fixture.detectChanges();
    expect(selectedIds()).toEqual(['top']);

    button('zone-modal-interaction-mode').click();
    fixture.detectChanges();

    expect(fixture.componentInstance.interactionMode()).toBe('reorder');
    expect(selectedIds()).toEqual([]);
    expect(cardButton('top').getAttribute('draggable')).toBe('true');
    expect(cardButton('top').getAttribute('aria-pressed')).toBeNull();
  });

  it('requires explicit confirmation and preserves local selection order for a selected batch', async () => {
    fixture = createFixture(readyModal());
    const requested = vi.fn();
    fixture.componentInstance.selectionBatchRequested.subscribe(requested);
    cardButton('second').click();
    cardButton('top').click();
    fixture.detectChanges();

    button('zone-modal-action-battlefield-face-down').click();
    fixture.detectChanges();
    await flushFocus();

    const confirmation = fixture.nativeElement.querySelector('[data-testid="zone-modal-batch-confirmation"]') as HTMLElement;
    expect(confirmation.getAttribute('role')).toBe('alertdialog');
    expect(requested).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button('zone-modal-batch-cancel'));

    button('zone-modal-batch-confirm').click();
    expect(requested).toHaveBeenCalledWith({
      action: 'battlefield-face-down',
      orderedInstanceIds: ['second', 'top'],
    });
  });

  it('scrolls each focused batch action into the horizontal toolbar viewport', () => {
    fixture = createFixture(readyModal());
    const action = button('zone-modal-action-library-bottom');
    const scrollIntoView = vi.fn();
    Object.defineProperty(action, 'scrollIntoView', { configurable: true, value: scrollIntoView });

    action.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });

  it('keeps top X distinct from selection and Escape cancels only the confirmation', async () => {
    fixture = createFixture(readyModal());
    const closed = vi.fn();
    const requested = vi.fn();
    fixture.componentInstance.close.subscribe(closed);
    fixture.componentInstance.topFaceDownRequested.subscribe(requested);

    button('zone-modal-action-top-face-down').click();
    fixture.detectChanges();
    const confirmation = fixture.nativeElement.querySelector('[data-testid="zone-modal-batch-confirmation"]') as HTMLElement;
    confirmation.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await flushFocus();

    expect(requested).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="zone-modal-batch-confirmation"]')).toBeNull();
    expect(document.activeElement).toBe(button('zone-modal-action-top-face-down'));
  });

  it('fails closed for a stale view and leaves no private card nodes', async () => {
    fixture = createFixture(readyModal({
      cards: [],
      total: 0,
      selectedCardId: null,
      selectedCard: null,
      lifecycle: 'stale',
      statusMessageKey: 'game.zoneModal.viewStale',
    }));
    await flushFocus();

    expect(fixture.nativeElement.querySelector('[data-testid="zone-modal-status"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-card-instance-id]')).toBeNull();
    expect(document.activeElement).toBe(button('zone-modal-close'));
    expect(fixture.componentInstance.selection().selectionOrder).toEqual([]);
  });

  function createFixture(modal: ZoneModalState): ComponentFixture<ZoneModalComponent> {
    const currentFixture = TestBed.createComponent(ZoneModalComponent);
    currentFixture.componentRef.setInput('modal', modal);
    currentFixture.componentRef.setInput('cardImage', (card: GameCardInstance) => card.imageUris?.['normal'] ?? null);
    currentFixture.detectChanges();
    return currentFixture;
  }

  function cardButton(instanceId: string): HTMLButtonElement {
    return fixture.nativeElement.querySelector(`[data-card-instance-id="${instanceId}"]`) as HTMLButtonElement;
  }

  function button(testId: string): HTMLButtonElement {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement;
  }

  function selectedIds(): string[] {
    const host = fixture.nativeElement as HTMLElement;
    return Array.from(host.querySelectorAll<HTMLElement>('[data-view-x-selected="true"]'))
      .map((element) => element.dataset['cardInstanceId'] as string);
  }
});

function readyModal(overrides: Partial<ZoneModalState> = {}): ZoneModalState {
  const visibleCards = [card('top'), card('second'), card('third')];
  return {
    playerId: 'owner',
    zone: 'library',
    title: 'Owner top 3 library cards',
    selectedCardId: 'top',
    cards: visibleCards,
    filterSourceCards: null,
    total: visibleCards.length,
    type: '',
    search: '',
    showFilters: false,
    readOnly: false,
    allowRandomSelect: false,
    allowReorder: false,
    drawOrderLabels: ['NEXT DRAW', 'SECOND DRAW', 'THIRD DRAW'],
    viewTopCount: 3,
    selectedCard: visibleCards[0] as GameCardInstance,
    loading: false,
    lifecycle: 'ready',
    statusMessageKey: null,
    localMultiSelect: true,
    selectionRevision: 'window-1',
    libraryWindow: { windowId: 'lw-window-1', expectedEpoch: 3, openedAtVersion: 10, status: 'active' },
    mutationPending: false,
    mutationErrorKey: null,
    ...overrides,
  };
}

function card(instanceId: string): GameCardInstance {
  return {
    instanceId,
    name: `Card ${instanceId}`,
    tapped: false,
    imageUris: { normal: `/${instanceId}.jpg` },
  };
}

async function flushFocus(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}
