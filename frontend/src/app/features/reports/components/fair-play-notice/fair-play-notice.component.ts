import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { AppThemeAssetsService } from '../../../../core/theme/app-theme-assets.service';
import { AppModalComponent } from '../../../../shared/ui/app-modal/app-modal.component';
import { FairPlayNoticeService } from '../../data-access/fair-play-notice.service';

const BALANCE_CARD_IMAGE_URL =
  'https://cards.scryfall.io/normal/front/c/e/ce648aa3-098b-4af0-a433-fd290bc85904.jpg?1783937636';

@Component({
  selector: 'app-fair-play-notice',
  imports: [AppModalComponent],
  templateUrl: './fair-play-notice.component.html',
  styleUrl: './fair-play-notice.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FairPlayNoticeComponent {
  private readonly notice = inject(FairPlayNoticeService);
  readonly themeAssets = inject(AppThemeAssetsService);
  readonly userId = input<string | null>(null);
  readonly gameId = input<string | null>(null);
  readonly open = this.notice.activeKey;
  readonly balanceCardImageUrl = BALANCE_CARD_IMAGE_URL;

  constructor() {
    effect(() => this.notice.showIfNeeded(this.userId(), this.gameId()));
  }

  acknowledge(): void {
    this.notice.acknowledge();
  }
}
