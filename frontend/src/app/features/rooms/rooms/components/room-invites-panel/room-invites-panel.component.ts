import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { RoomInvite } from '../../../../../core/models/room-invite.model';
import { PrettyScrollDirective } from '../../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { PlayerNameComponent } from '../../../../../shared/ui/player-name/player-name.component';
import { CzButtonDirective } from '../../../../../shared/ui/button/button.directive';

@Component({
  selector: 'app-room-invites-panel',
  imports: [RuntimeTranslatePipe, LucideAngularModule, PrettyScrollDirective, PlayerNameComponent, CzButtonDirective],
  templateUrl: './room-invites-panel.component.html',
  styleUrl: './room-invites-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoomInvitesPanelComponent {
  readonly invites = input<readonly RoomInvite[]>([]);
  readonly accepted = output<RoomInvite>();
  readonly declined = output<RoomInvite>();
}
