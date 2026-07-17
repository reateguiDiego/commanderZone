import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { GameCardInstance } from '../../../../../core/models/game.model';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { BodyScrollLockService } from '../../../../../shared/services/body-scroll-lock.service';
import { PlayerView } from '../../game-table.store';
import { GameTableResponsiveState } from '../../utils/game-table-responsive-state';
import { CardSpoilerGridComponent } from '../card-spoiler-grid/card-spoiler-grid.component';

export interface ActiveRevealRevokeRequest {
  readonly instanceId: string;
  readonly trigger: HTMLElement | null;
}

@Component({
  selector: 'app-active-reveal-panel',
  imports: [CardSpoilerGridComponent, LucideAngularModule, RuntimeTranslatePipe],
  templateUrl: './active-reveal-panel.component.html',
  styleUrl: './active-reveal-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActiveRevealPanelComponent implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly bodyScrollLock = inject(BodyScrollLockService);

  @ViewChild(CardSpoilerGridComponent) private readonly cardGrid?: CardSpoilerGridComponent;

  readonly owner = input.required<PlayerView>();
  readonly viewerPlayerId = input.required<string>();
  readonly ownerMode = input(false);
  readonly cards = input.required<readonly GameCardInstance[]>();
  readonly players = input.required<readonly PlayerView[]>();
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();
  readonly responsiveState = input.required<GameTableResponsiveState>();

  readonly closed = output<void>();
  readonly revokeRequested = output<ActiveRevealRevokeRequest>();
  readonly opened = output<HTMLElement>();

  readonly focusedCardId = signal<string | null>(null);
  readonly focusedCard = computed(() => this.cards().find((card) => card.instanceId === this.focusedCardId())
    ?? this.cards()[0]
    ?? null);
  readonly recipientLabels = computed<readonly string[]>(() => {
    if (!this.ownerMode()) {
      return [];
    }
    const audience = this.focusedCard()?.revealedTo ?? [];
    if (audience.includes('all')) {
      return ['game.activeReveals.allPlayers'];
    }
    const ownerId = this.owner().id;
    return audience
      .filter((playerId) => playerId !== ownerId)
      .map((playerId) => this.players().find((player) => player.id === playerId)?.state.user.displayName ?? playerId);
  });

  constructor() {
    this.bodyScrollLock.lock();
    effect(() => {
      const cards = this.cards();
      const currentId = this.focusedCardId();
      if (currentId && cards.some((card) => card.instanceId === currentId)) {
        return;
      }
      this.focusedCardId.set(cards[0]?.instanceId ?? null);
      queueMicrotask(() => this.cardGrid?.focusCardById(this.focusedCardId()));
    }, { allowSignalWrites: true });
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => {
      this.cardGrid?.focusCardById(this.focusedCardId());
      const dialog = this.host.nativeElement.querySelector<HTMLElement>('[data-testid="active-reveal-panel"]');
      if (dialog) {
        this.opened.emit(dialog);
      }
    });
  }

  ngOnDestroy(): void {
    this.bodyScrollLock.unlock();
  }

  focusCard(card: GameCardInstance): void {
    this.focusedCardId.set(card.instanceId);
  }

  requestRevoke(event: MouseEvent): void {
    event.stopPropagation();
    const card = this.focusedCard();
    if (!card || !this.ownerMode()) {
      return;
    }
    this.revokeRequested.emit({ instanceId: card.instanceId, trigger: event.currentTarget as HTMLElement | null });
  }

  close(): void {
    this.closed.emit();
  }

  closeFromBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = this.focusableElements();
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    if (currentIndex < 0) {
      event.preventDefault();
      (event.shiftKey ? focusable.at(-1) : focusable[0])?.focus();
    } else if (event.shiftKey && currentIndex === 0) {
      event.preventDefault();
      focusable.at(-1)?.focus();
    } else if (!event.shiftKey && currentIndex === focusable.length - 1) {
      event.preventDefault();
      focusable[0]?.focus();
    }
  }

  private focusableElements(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hasAttribute('hidden'));
  }
}
