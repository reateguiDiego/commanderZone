import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PlayerView } from '../../game-table.store';
import { HandRevealDialogComponent } from './hand-reveal-dialog.component';

describe('HandRevealDialogComponent', () => {
  let fixture: ComponentFixture<HandRevealDialogComponent>;

  afterEach(() => {
    fixture?.destroy();
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  });

  it('renders an accessible dialog, locks body scroll and focuses the first action', async () => {
    fixture = await renderDialog();
    await flushFocus();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('hand-reveal-title');
    expect(document.body.style.overflow).toBe('hidden');
    expect((document.activeElement as HTMLInputElement).value).toBe('reveal');
  });

  it('supports all, multi-viewer selection and one explicit batch confirmation', async () => {
    fixture = await renderDialog('player-2');
    const confirmed = vi.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);

    const third = input('hand-reveal-audience-player-3');
    third.checked = true;
    third.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    fixture.componentInstance.confirm();

    expect(confirmed).toHaveBeenCalledOnce();
    expect(confirmed).toHaveBeenCalledWith({ mode: 'reveal', audience: ['player-2', 'player-3'] });
  });

  it('emits an atomic revoke intent without exposing a per-card loop', async () => {
    fixture = await renderDialog('player-2', false, testPlayers(), ['player-2']);
    const confirmed = vi.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);

    const revoke = fixture.nativeElement.querySelector('input[value="revoke"]') as HTMLInputElement;
    revoke.checked = true;
    revoke.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const all = input('hand-reveal-audience-all');
    all.checked = false;
    all.dispatchEvent(new Event('change'));
    const target = input('hand-reveal-audience-player-2');
    target.checked = true;
    target.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    fixture.componentInstance.confirm();

    expect(confirmed).toHaveBeenCalledWith({ mode: 'revoke', audience: ['player-2'] });
  });

  it('offers revoke only for the union of recipients currently authorized on the selected cards', async () => {
    fixture = await renderDialog('all', false, testPlayers(), ['player-3']);
    const revoke = fixture.nativeElement.querySelector('input[value="revoke"]') as HTMLInputElement;
    revoke.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(Array.from(fixture.nativeElement.querySelectorAll('.player-options label')).map((label: any) => label.textContent?.trim())).toEqual(['Cara']);
  });

  it('disables revoke when none of the selected cards is actively shared', async () => {
    fixture = await renderDialog();
    expect((fixture.nativeElement.querySelector('input[value="revoke"]') as HTMLInputElement).disabled).toBe(true);
  });

  it('disables cancellation and duplicate submit while pending', async () => {
    fixture = await renderDialog('all', true);
    const cancelled = vi.fn();
    fixture.componentInstance.cancelled.subscribe(cancelled);

    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons.every((button) => button.disabled)).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('closes with Escape and keeps Tab focus inside', async () => {
    fixture = await renderDialog();
    const cancelled = vi.fn();
    fixture.componentInstance.cancelled.subscribe(cancelled);
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const last = buttons.at(-1)!;
    last.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect((fixture.nativeElement as HTMLElement).contains(document.activeElement)).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('re-enters the focus trap when focus was moved outside the dialog', async () => {
    fixture = await renderDialog();
    await flushFocus();

    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(fixture.nativeElement.contains(document.activeElement)).toBe(true);
    outside.remove();
  });

  it('filters the owner and defeated players from recipients', async () => {
    fixture = await renderDialog('all', false, [
      player('player-1', 'Alice'),
      player('player-2', 'Bob'),
      { ...player('player-3', 'Cara'), state: { ...player('player-3', 'Cara').state, status: 'defeated', life: 0 } },
    ]);
    const labels = Array.from(fixture.nativeElement.querySelectorAll('.player-options label') as NodeListOf<Element>);
    expect(labels.map((label) => label.textContent?.trim())).toEqual(['Bob']);
  });

  function input(testId: string): HTMLInputElement {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;
  }
});

async function renderDialog(
  initialTarget = 'all',
  pending = false,
  players = testPlayers(),
  revokePlayerIds: readonly string[] = [],
  publicRevealSelected = false,
): Promise<ComponentFixture<HandRevealDialogComponent>> {
  await TestBed.configureTestingModule({ imports: [HandRevealDialogComponent] }).compileComponents();
  const fixture = TestBed.createComponent(HandRevealDialogComponent);
  fixture.componentRef.setInput('requestKey', 'request-1');
  fixture.componentRef.setInput('ownerPlayerId', 'player-1');
  fixture.componentRef.setInput('cardCount', 3);
  fixture.componentRef.setInput('players', players);
  fixture.componentRef.setInput('initialTarget', initialTarget);
  fixture.componentRef.setInput('revokePlayerIds', revokePlayerIds);
  fixture.componentRef.setInput('publicRevealSelected', publicRevealSelected);
  fixture.componentRef.setInput('pending', pending);
  fixture.componentRef.setInput('error', null);
  fixture.detectChanges();
  return fixture;
}

function testPlayers(): PlayerView[] {
  return [player('player-1', 'Alice'), player('player-2', 'Bob'), player('player-3', 'Cara')];
}

function player(id: string, displayName: string): PlayerView {
  return {
    id,
    state: {
      user: { id, email: `${id}@test`, displayName, roles: [] },
      status: 'active',
      life: 40,
      zones: { library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [] },
      commanderDamage: {},
      counters: {},
    },
  };
}

async function flushFocus(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
