import { ChangeDetectionStrategy, Component, EventEmitter, inject, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { BodyScrollLockService } from '../../services/body-scroll-lock.service';
import { PrettyScrollDirective } from '../pretty-scroll/pretty-scroll.directive';
import { CzButtonDirective } from '../button/button.directive';
import { HeroRuleComponent } from '../hero-rule/hero-rule.component';

@Component({
  selector: 'app-modal',
  imports: [LucideAngularModule, CzButtonDirective, PrettyScrollDirective, HeroRuleComponent],
  templateUrl: './app-modal.component.html',
  styleUrl: './app-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppModalComponent implements OnChanges, OnDestroy {
  private readonly bodyScrollLock = inject(BodyScrollLockService);

  @Input() open = false;
  @Input() title = '';
  @Input() titleIcon = '';
  @Input() ariaLabel = '';
  @Input() message = '';
  @Input() headerImageSrc: string | null = null;
  @Input() headerImageAlt = '';
  @Input() primaryLabel = 'OK';
  @Input() secondaryLabel = 'Cancel';
  @Input() danger = false;
  @Input() showPrimary = true;
  @Input() showSecondary = true;
  @Input() primaryDisabled = false;
  @Input() secondaryVariant: 'primary' | 'secondary' = 'secondary';
  @Input() showBackButton = false;
  @Input() backLabel = 'Back';
  @Input() showHeaderAction = false;
  @Input() headerActionLabel = '';
  @Input() showHeaderRule = false;
  @Input() showCloseButton = false;
  @Input() closeLabel = 'Close modal';
  @Input() showTertiary = false;
  @Input() tertiaryLabel = 'Cancel';
  @Input() footerLayout: 'default' | 'split' = 'default';
  @Input() footerNotice = '';
  @Input() lockBodyScroll = true;
  @Input() closeOnBackdrop = false;
  @Input() size: 'default' | 'compact' | 'narrow' | 'wide' = 'default';
  @Input() panelOverflow: 'auto' | 'visible' = 'auto';

  @Output() back = new EventEmitter<void>();
  @Output() headerAction = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();
  @Output() tertiary = new EventEmitter<void>();
  @Output() primary = new EventEmitter<void>();
  @Output() secondary = new EventEmitter<void>();

  private scrollLocked = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['open']) {
      return;
    }

    if (this.open && this.lockBodyScroll) {
      this.lockBodyPageScroll();
    } else {
      this.unlockBodyPageScroll();
    }
  }

  ngOnDestroy(): void {
    this.unlockBodyPageScroll();
  }

  private lockBodyPageScroll(): void {
    if (this.scrollLocked) {
      return;
    }

    this.bodyScrollLock.lock();
    this.scrollLocked = true;
  }

  private unlockBodyPageScroll(): void {
    if (!this.scrollLocked) {
      return;
    }

    this.bodyScrollLock.unlock();
    this.scrollLocked = false;
  }
}
