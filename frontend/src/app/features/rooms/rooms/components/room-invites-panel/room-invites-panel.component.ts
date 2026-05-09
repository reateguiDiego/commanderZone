import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { RoomInvite } from '../../../../../core/models/room-invite.model';
import { PrettyScrollDirective } from '../../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { PlayerNameComponent } from '../../../../../shared/ui/player-name/player-name.component';

@Component({
  selector: 'app-room-invites-panel',
  imports: [LucideAngularModule, PrettyScrollDirective, PlayerNameComponent],
  templateUrl: './room-invites-panel.component.html',
  styleUrl: './room-invites-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoomInvitesPanelComponent {
  readonly invites = input<readonly RoomInvite[]>([]);
  readonly accepted = output<RoomInvite>();
  readonly declined = output<RoomInvite>();
}
