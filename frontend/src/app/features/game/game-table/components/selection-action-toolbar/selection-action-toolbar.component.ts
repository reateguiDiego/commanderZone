import { ChangeDetectionStrategy, Component, ElementRef, input, output, viewChild } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { AppModalComponent } from '../../../../../shared/ui/app-modal/app-modal.component';
import { SelectionActionAvailability, SelectionActionConfirmation, SelectionActionId } from '../../models/selection-action.model';

@Component({
  selector: 'app-selection-action-toolbar',
  imports: [RuntimeTranslatePipe, AppModalComponent],
  templateUrl: './selection-action-toolbar.component.html',
  styleUrl: './selection-action-toolbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectionActionToolbarComponent {
  readonly count = input.required<number>();
  readonly groupCount = input(0);
  readonly actions = input.required<readonly SelectionActionAvailability[]>();
  readonly pendingActionId = input<SelectionActionId | null>(null);
  readonly errorKey = input<string | null>(null);
  readonly errorCode = input<string | null>(null);
  readonly confirmation = input<SelectionActionConfirmation | null>(null);

  readonly actionRequested = output<SelectionActionId>();
  readonly clearRequested = output<void>();
  readonly confirmationAccepted = output<void>();
  readonly confirmationCancelled = output<void>();
  readonly errorDismissed = output<void>();

  private lastTrigger: HTMLButtonElement | null = null;
  private readonly toolbar = viewChild<ElementRef<HTMLElement>>('toolbar');

  request(event: Event, action: SelectionActionAvailability): void {
    if (!action.enabled || this.pendingActionId() !== null) return;
    this.lastTrigger = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
    this.actionRequested.emit(action.actionId);
  }

  cancelConfirmation(): void {
    this.confirmationCancelled.emit();
    this.restoreFocus();
  }

  confirm(): void {
    this.confirmationAccepted.emit();
    this.restoreFocus();
  }

  clear(): void {
    this.clearRequested.emit();
    queueMicrotask(() => this.toolbar()?.nativeElement.focus());
  }

  trackAction(_index: number, action: SelectionActionAvailability): SelectionActionId {
    return action.actionId;
  }

  private restoreFocus(): void {
    const trigger = this.lastTrigger;
    queueMicrotask(() => {
      if (trigger?.isConnected) trigger.focus();
      else this.toolbar()?.nativeElement.focus();
    });
  }
}
