import { DOCUMENT } from '@angular/common';
import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, inject, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { BodyScrollLockService } from '../../services/body-scroll-lock.service';
import { PrettyScrollDirective } from '../pretty-scroll/pretty-scroll.directive';
import { CzButtonDirective } from '../button/button.directive';
import { BackButtonComponent } from '../back-button/back-button.component';
import { HeroRuleComponent } from '../hero-rule/hero-rule.component';
import { TextFitDirective } from '../text-fit/text-fit.directive';

@Component({
  selector: 'app-modal',
  imports: [LucideAngularModule, RuntimeTranslatePipe, CzButtonDirective, PrettyScrollDirective, HeroRuleComponent, BackButtonComponent, TextFitDirective],
  templateUrl: './app-modal.component.html',
  styleUrl: './app-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppModalComponent implements OnChanges, AfterViewInit, OnDestroy {
  private readonly bodyScrollLock = inject(BodyScrollLockService);
  private readonly document = inject(DOCUMENT);

  @ViewChild('dialogPanel') private dialogPanel?: ElementRef<HTMLElement>;

  @Input() open = false;
  @Input() title = '';
  @Input() titleIcon = '';
  @Input() ariaLabel = '';
  @Input() message = '';
  @Input() messageParams: Record<string, unknown> | undefined;
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
  @Input() trapFocus = false;

  @Output() back = new EventEmitter<void>();
  @Output() headerAction = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();
  @Output() tertiary = new EventEmitter<void>();
  @Output() primary = new EventEmitter<void>();
  @Output() secondary = new EventEmitter<void>();

  private scrollLocked = false;
  private focusBeforeOpen: HTMLElement | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['open']) {
      return;
    }

    if (this.open && this.lockBodyScroll) {
      this.lockBodyPageScroll();
    } else {
      this.unlockBodyPageScroll();
    }

    if (this.open && this.trapFocus) {
      this.focusBeforeOpen = this.document.activeElement instanceof HTMLElement ? this.document.activeElement : null;
      this.scheduleInitialFocus();
    } else if (!this.open) {
      this.restoreFocus();
    }
  }

  ngAfterViewInit(): void {
    if (this.open && this.trapFocus) this.scheduleInitialFocus();
  }

  ngOnDestroy(): void {
    this.unlockBodyPageScroll();
    this.restoreFocus();
  }

  handleDialogKeydown(event: KeyboardEvent): void {
    if (!this.trapFocus || event.key !== 'Tab') return;
    const focusable = this.focusableElements();
    if (focusable.length === 0) {
      event.preventDefault();
      this.dialogPanel?.nativeElement.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    const active = this.document.activeElement;
    if (event.shiftKey && (active === first || !this.dialogPanel?.nativeElement.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
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

  private scheduleInitialFocus(): void {
    queueMicrotask(() => {
      if (!this.open || !this.trapFocus) return;
      (this.focusableElements()[0] ?? this.dialogPanel?.nativeElement)?.focus();
    });
  }

  private focusableElements(): HTMLElement[] {
    const panel = this.dialogPanel?.nativeElement;
    if (!panel) return [];
    return Array.from(panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true');
  }

  private restoreFocus(): void {
    const target = this.focusBeforeOpen;
    this.focusBeforeOpen = null;
    queueMicrotask(() => {
      if (target?.isConnected) target.focus();
    });
  }
}
