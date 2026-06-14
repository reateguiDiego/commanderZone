import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { AuthStore } from '../../../../../core/auth/auth.store';
import { UserAvatar, UserDisplayNameStyle } from '../../../../../core/models/user.model';
import { PlayerAvatarComponent } from '../../../../../shared/ui/player-avatar/player-avatar.component';
import { PlayerNameComponent } from '../../../../../shared/ui/player-name/player-name.component';
import { DashboardSettingsModalComponent } from '../../../../dashboard/dashboard-shell/components/dashboard-header-controls/components/dashboard-settings-modal/dashboard-settings-modal.component';
import { GameTableHeaderMenuComponent } from './game-table-header-menu/game-table-header-menu.component';
import { GameTableSpecialEntitiesState } from '../../state/helpers/game-table-special-entities.state';

@Component({
  selector: 'app-game-table-header',
  imports: [RuntimeTranslatePipe,
    LucideAngularModule,
    PlayerAvatarComponent,
    PlayerNameComponent,
    DashboardSettingsModalComponent,
    GameTableHeaderMenuComponent,
  ],
  templateUrl: './game-table-header.component.html',
  styleUrl: './game-table-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameTableHeaderComponent {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  readonly specialEntities = inject(GameTableSpecialEntitiesState);
  readonly settingsOpen = signal(false);
  readonly userLabel = computed(() => this.auth.user()?.displayName || this.auth.user()?.email || 'Player');
  readonly userAvatar = computed<UserAvatar | null | undefined>(() => this.auth.user()?.avatar);
  readonly userNameStyle = computed<UserDisplayNameStyle | null | undefined>(() => this.auth.user()?.displayNameStyle);

  openSettings(): void {
    this.settingsOpen.set(true);
  }

  closeSettings(): void {
    this.settingsOpen.set(false);
  }

  async logout(): Promise<void> {
    this.closeSettings();
    await this.auth.logout();
    await this.router.navigate(['/auth/login']);
  }
}
