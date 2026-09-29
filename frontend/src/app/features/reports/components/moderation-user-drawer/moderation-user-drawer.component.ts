import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { MessagesApi } from '../../../../core/api/messages.api';
import { UserMessage } from '../../../../core/models/message.model';
import { AppModalComponent } from '../../../../shared/ui/app-modal/app-modal.component';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { CzButtonDirective } from '../../../../shared/ui/button/button.directive';
import { MessageBodyComponent } from '../../../../shared/ui/message-body/message-body.component';
import { TabListComponent, TabListItem } from '../../../../shared/ui/tab-list/tab-list.component';
import { TooltipComponent } from '../../../../shared/ui/tooltip/tooltip.component';
import { ReportsApi } from '../../data-access/reports.api';
import { ModerationUser, UserStrike } from '../../data-access/reports.models';

type ModerationUserDrawerTab = 'strikes' | 'messages';

const MODERATION_USER_DRAWER_TABS: readonly TabListItem[] = [
  { id: 'strikes', label: 'reports.moderation.strikes.listTitle' },
  { id: 'messages', label: 'shared.text.messages' },
];

@Component({
  selector: 'app-moderation-user-drawer',
  imports: [
    AppModalComponent,
    RuntimeTranslatePipe,
    CzButtonDirective,
    DatePipe,
    TabListComponent,
    MessageBodyComponent,
    LucideAngularModule,
    TooltipComponent,
  ],
  templateUrl: './moderation-user-drawer.component.html',
  styleUrl: './moderation-user-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModerationUserDrawerComponent {
  private readonly api = inject(ReportsApi);
  private readonly messagesApi = inject(MessagesApi);
  private loadedUserId: string | null = null;
  private loadedMessagesUserId: string | null = null;
  private loadingMessagesUserId: string | null = null;
  private messagesRequestVersion = 0;

  readonly open = input(false);
  readonly userId = input<string | null>(null);
  readonly closed = output<void>();
  readonly updated = output<void>();
  readonly user = signal<ModerationUser | null>(null);
  readonly strikes = signal<readonly UserStrike[]>([]);
  readonly messages = signal<readonly UserMessage[]>([]);
  readonly activeTab = signal<ModerationUserDrawerTab>('strikes');
  readonly expandedMessageId = signal<string | null>(null);
  readonly loading = signal(false);
  readonly messagesLoading = signal(false);
  readonly creatingStrike = signal(false);
  readonly deletingStrikeId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly messagesError = signal<string | null>(null);
  readonly strikeDescription = signal('');
  readonly dateTimeFormat = 'dd/MM/yyyy HH:mm';
  readonly tabs = MODERATION_USER_DRAWER_TABS;

  constructor() {
    effect(() => {
      const userId = this.userId();
      if (!this.open() || !userId || userId === this.loadedUserId) {
        return;
      }

      this.loadedUserId = userId;
      this.activeTab.set('strikes');
      this.resetMessages();
      void this.load(userId);
    });
  }

  close(): void {
    if (this.creatingStrike() || this.deletingStrikeId()) {
      return;
    }

    this.loadedUserId = null;
    this.activeTab.set('strikes');
    this.resetMessages();
    this.closed.emit();
  }

  selectTab(tab: string): void {
    if (!isModerationUserDrawerTab(tab)) {
      return;
    }

    this.activeTab.set(tab);
    if (tab === 'messages') {
      const userId = this.userId();
      if (userId) {
        void this.loadMessages(userId);
      }
    }
  }

  toggleMessage(messageId: string): void {
    this.expandedMessageId.update((current) => (current === messageId ? null : messageId));
  }

  updateStrikeDescription(value: string): void {
    this.strikeDescription.set(value);
  }

  updateStrikeDescriptionFromEvent(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement) {
      this.updateStrikeDescription(target.value);
    }
  }

  async createStrike(): Promise<void> {
    const userId = this.userId();
    const description = this.strikeDescription().trim();
    if (!userId || this.creatingStrike()) {
      return;
    }
    if (description === '') {
      this.error.set('reports.moderation.strikes.descriptionRequired');
      return;
    }

    this.creatingStrike.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(this.api.createUserStrike(userId, { description }));
      this.user.update((user) => (user ? { ...user, strikesCount: response.strikesCount } : user));
      const strike = response.strike;
      if (strike) {
        this.strikes.update((strikes) => [strike, ...strikes]);
      }
      this.strikeDescription.set('');
      this.updated.emit();
    } catch {
      this.error.set('reports.moderation.errors.createStrike');
    } finally {
      this.creatingStrike.set(false);
    }
  }

  async deleteStrike(strike: UserStrike): Promise<void> {
    const userId = this.userId();
    if (!userId || this.deletingStrikeId()) {
      return;
    }

    this.deletingStrikeId.set(strike.id);
    this.error.set(null);
    try {
      const response = await firstValueFrom(this.api.deleteUserStrike(userId, strike.id));
      this.strikes.update((strikes) => strikes.filter((candidate) => candidate.id !== strike.id));
      this.user.update((user) => (user ? { ...user, strikesCount: response.strikesCount } : user));
      this.updated.emit();
    } catch {
      this.error.set('reports.moderation.errors.deleteStrike');
    } finally {
      this.deletingStrikeId.set(null);
    }
  }

  private async load(userId: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.user.set(null);
    this.strikes.set([]);
    try {
      const response = await firstValueFrom(this.api.getUserModeration(userId));
      if (this.userId() === userId && this.open()) {
        this.user.set(response.user);
        this.strikes.set(response.strikes);
      }
    } catch {
      if (this.userId() === userId) {
        this.error.set('reports.moderation.errors.loadUser');
      }
    } finally {
      if (this.userId() === userId) {
        this.loading.set(false);
      }
    }
  }

  private async loadMessages(userId: string): Promise<void> {
    if (this.loadedMessagesUserId === userId || this.loadingMessagesUserId === userId) {
      return;
    }

    const requestVersion = ++this.messagesRequestVersion;
    this.loadingMessagesUserId = userId;
    this.messagesLoading.set(true);
    this.messagesError.set(null);
    this.messages.set([]);
    this.expandedMessageId.set(null);

    try {
      const response = await firstValueFrom(this.messagesApi.listAdminUserMessages(userId));
      if (this.isCurrentMessagesRequest(userId, requestVersion)) {
        this.messages.set(response.messages);
        this.loadedMessagesUserId = userId;
      }
    } catch {
      if (this.isCurrentMessagesRequest(userId, requestVersion)) {
        this.messagesError.set('reports.moderation.errors.loadMessages');
      }
    } finally {
      if (this.isCurrentMessagesRequest(userId, requestVersion)) {
        this.loadingMessagesUserId = null;
        this.messagesLoading.set(false);
      }
    }
  }

  private resetMessages(): void {
    this.messagesRequestVersion += 1;
    this.loadedMessagesUserId = null;
    this.loadingMessagesUserId = null;
    this.messages.set([]);
    this.expandedMessageId.set(null);
    this.messagesLoading.set(false);
    this.messagesError.set(null);
  }

  private isCurrentMessagesRequest(userId: string, requestVersion: number): boolean {
    return this.open() && this.userId() === userId && this.messagesRequestVersion === requestVersion;
  }
}

function isModerationUserDrawerTab(value: string): value is ModerationUserDrawerTab {
  return value === 'strikes' || value === 'messages';
}
