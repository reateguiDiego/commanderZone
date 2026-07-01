import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { MessageBodyComponent } from '../../../shared/ui/message-body/message-body.component';
import { PrettyScrollDirective } from '../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { PlayerInfoComponent } from '../../../shared/ui/player-info/player-info.component';
import { MessagesStore } from '../data-access/messages.store';

@Component({
  selector: 'app-messages-dropdown',
  imports: [LucideAngularModule, RuntimeTranslatePipe, MessageBodyComponent, PrettyScrollDirective, PlayerInfoComponent],
  templateUrl: './messages-dropdown.component.html',
  styleUrl: './messages-dropdown.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessagesDropdownComponent {
  readonly store = inject(MessagesStore);

  selectMessage(messageId: string): void {
    void this.store.selectMessage(messageId);
  }
}
