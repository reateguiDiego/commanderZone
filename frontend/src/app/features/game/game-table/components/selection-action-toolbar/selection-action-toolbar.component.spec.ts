import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SelectionActionAvailability } from '../../models/selection-action.model';
import { SelectionActionToolbarComponent } from './selection-action-toolbar.component';

describe('SelectionActionToolbarComponent', () => {
  let fixture: ComponentFixture<SelectionActionToolbarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SelectionActionToolbarComponent] }).compileComponents();
    fixture = TestBed.createComponent(SelectionActionToolbarComponent);
    fixture.componentRef.setInput('count', 3);
    fixture.componentRef.setInput('groupCount', 1);
    fixture.componentRef.setInput('actions', [action('tap', true), action('untap', false)]);
    fixture.detectChanges();
  });

  it('renders count, group count and explainable action availability', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="selection-count"]')?.textContent).toContain('3');
    const tap = root.querySelector<HTMLButtonElement>('[data-testid="selection-action-tap"]')!;
    const untap = root.querySelector<HTMLButtonElement>('[data-testid="selection-action-untap"]')!;
    expect(tap.disabled).toBe(false);
    expect(untap.disabled).toBe(true);
    expect(untap.title).toContain('already');
  });

  it('emits one action and disables duplicate submits while pending', () => {
    const emitted: string[] = [];
    fixture.componentInstance.actionRequested.subscribe((value) => emitted.push(value));
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="selection-action-tap"]')!.click();
    expect(emitted).toEqual(['tap']);
    fixture.componentRef.setInput('pendingActionId', 'tap');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="selection-action-tap"]')!.disabled).toBe(true);
  });

  it('renders a confirmation dialog with affected count', () => {
    fixture.componentRef.setInput('confirmation', { action: { ...action('faceDown', true), affectedCount: 3, requiresConfirmation: true }, messageKey: 'game.selectionBatch.confirm.faceDown' });
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('3');
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('exposes a safe structured rejection code without rendering private details', () => {
    fixture.componentRef.setInput('errorKey', 'game.selectionBatch.disabled.notControlled');
    fixture.componentRef.setInput('errorCode', 'MIXED_AUTHORITY_BATCH');
    fixture.detectChanges();
    const error = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="selection-action-error"]')!;
    expect(error.dataset['errorCode']).toBe('MIXED_AUTHORITY_BATCH');
    expect(error.textContent).not.toContain('card-1');
  });
});

function action(actionId: 'tap' | 'untap' | 'faceDown', enabled: boolean): SelectionActionAvailability {
  return {
    actionId, enabled, visible: true,
    reasonDisabled: enabled ? null : 'game.selectionBatch.disabled.alreadyUntapped',
    requiresConfirmation: false, supportsBatch: true, affectedCount: 3, resolvesGroupMembers: false,
    destinationOptions: [], privacyImpact: 'none', commandType: actionId === 'faceDown' ? 'cards.face_down.set' : 'cards.tapped.set',
    labelKey: `game.selectionBatch.actions.${actionId}`, category: 'battlefield',
  };
}
