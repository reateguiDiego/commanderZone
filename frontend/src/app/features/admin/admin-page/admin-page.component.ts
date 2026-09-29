import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { AuthStore } from '../../../core/auth/auth.store';
import { canAccessModeration } from '../../../core/auth/user-roles';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';
import { AdminNotificationsPanelComponent } from '../components/admin-notifications-panel/admin-notifications-panel.component';
import { AdminReportsPanelComponent } from '../components/admin-reports-panel/admin-reports-panel.component';
import { ModerationSummaryStore } from '../../reports/data-access/moderation-summary.store';
import {
  AdminMessageRecipientSelection,
  AdminUsersPanelComponent,
} from '../components/admin-users-panel/admin-users-panel.component';

type AdminSectionId = 'users' | 'reports' | 'notifications';

interface AdminNavigationItem {
  readonly id: AdminSectionId;
  readonly label: string;
  readonly icon: string;
  readonly pendingReviewCount?: number;
  readonly pendingReviewBadgeLabel?: string;
}

@Component({
  selector: 'app-admin-page',
  imports: [
    LucideAngularModule,
    RuntimeTranslatePipe,
    CzButtonDirective,
    AdminNotificationsPanelComponent,
    AdminReportsPanelComponent,
    AdminUsersPanelComponent,
  ],
  templateUrl: './admin-page.component.html',
  styleUrl: './admin-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminPageComponent {
  private readonly auth = inject(AuthStore);
  private readonly moderationSummary = inject(ModerationSummaryStore);

  readonly activeSection = signal<AdminSectionId>('users');
  readonly preselectedNotificationRecipient = signal<AdminMessageRecipientSelection | null>(null);
  readonly contentPinnedToTop = computed(() => {
    const section = this.activeSection();

    return section === 'users' || section === 'reports';
  });
  readonly canModerate = computed(() => canAccessModeration(this.auth.user()));
  readonly navigationItems = computed<readonly AdminNavigationItem[]>(() => {
    const pendingReviewCount = this.moderationSummary.pendingReviewCount();

    return [
      { id: 'users', label: 'shared.text.users', icon: 'users' },
      ...(this.canModerate()
        ? [{
            id: 'reports' as const,
            label: 'shared.text.reports',
            icon: 'flag',
            pendingReviewCount,
            pendingReviewBadgeLabel: this.moderationSummary.badgeLabel(),
          }]
        : []),
      { id: 'notifications', label: 'shared.text.notifications', icon: 'bell' },
    ];
  });

  constructor() {
    effect(() => {
      if (!this.canModerate() && this.activeSection() === 'reports') {
        this.activeSection.set('users');
      }
    });
  }

  selectSection(sectionId: AdminSectionId): void {
    if (sectionId === 'reports' && !this.canModerate()) {
      return;
    }
    if (sectionId === 'notifications') {
      this.preselectedNotificationRecipient.set(null);
    }

    this.activeSection.set(sectionId);
  }

  openNotificationsForUser(recipient: AdminMessageRecipientSelection): void {
    this.activeSection.set('notifications');
    queueMicrotask(() => this.preselectedNotificationRecipient.set(recipient));
  }
}
