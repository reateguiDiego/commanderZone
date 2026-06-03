import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { ChatRecipientOption } from '../../models/game-table-chat.model';

@Component({
  selector: 'app-chat-recipient-select',
  imports: [RuntimeTranslatePipe, LucideAngularModule],
  templateUrl: './chat-recipient-select.component.html',
  styleUrl: './chat-recipient-select.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatRecipientSelectComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly recipients = input.required<readonly ChatRecipientOption[]>();
  readonly selectedValue = input.required<string>();
  readonly valueChanged = output<string | null>();
  readonly open = signal(false);
  readonly selectedRecipient = computed(() =>
    this.recipients().find((recipient) => this.optionValue(recipient) === this.selectedValue()) ?? this.recipients()[0] ?? null
  );
  readonly selectedRecipientLabel = computed(() => this.selectedRecipient()?.label ?? 'Todos');

  toggleOpen(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.open.update((open) => !open);
  }

  selectRecipient(event: MouseEvent, recipient: ChatRecipientOption): void {
    event.preventDefault();
    event.stopPropagation();
    this.valueChanged.emit(recipient.playerId);
    this.open.set(false);
  }

  optionValue(recipient: ChatRecipientOption): string {
    return recipient.playerId ?? 'all';
  }

  @HostListener('document:mousedown', ['$event'])
  closeFromOutsidePointer(event: MouseEvent): void {
    const target = event.target instanceof Node ? event.target : null;
    if (target && this.host.nativeElement.contains(target)) {
      return;
    }

    this.open.set(false);
  }

  @HostListener('keydown.escape')
  closeFromEscape(): void {
    this.open.set(false);
  }
}
