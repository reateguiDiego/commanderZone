import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';
import { AdminNotificationsPanelComponent } from '../components/admin-notifications-panel/admin-notifications-panel.component';
import { AdminReportsPanelComponent } from '../components/admin-reports-panel/admin-reports-panel.component';
import {
  AdminMessageRecipientSelection,
  AdminUsersPanelComponent,
} from '../components/admin-users-panel/admin-users-panel.component';

type AdminSectionId = 'users' | 'reports' | 'notifications';

interface AdminNavigationItem {
  readonly id: AdminSectionId;
  readonly label: string;
  readonly icon: string;
}

@Component({
  selector: 'app-admin-page',
  imports: [
    LucideAngularModule,
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
  readonly activeSection = signal<AdminSectionId>('users');
  readonly preselectedNotificationRecipient = signal<AdminMessageRecipientSelection | null>(null);
  readonly contentPinnedToTop = computed(() => {
    const section = this.activeSection();

    return section === 'users' || section === 'reports';
  });
  readonly navigationItems: readonly AdminNavigationItem[] = [
    { id: 'users', label: 'Users', icon: 'users' },
    { id: 'reports', label: 'Reports', icon: 'flag' },
    { id: 'notifications', label: 'Notifications', icon: 'bell' },
  ];

  selectSection(sectionId: AdminSectionId): void {
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
