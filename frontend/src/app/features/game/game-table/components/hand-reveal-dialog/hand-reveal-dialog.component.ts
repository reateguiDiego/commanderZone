import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, computed, effect, inject, input, output, signal } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { BodyScrollLockService } from '../../../../../shared/services/body-scroll-lock.service';
import { PlayerView } from '../../game-table.store';
import { playerIsDefeated } from '../../utils/game-player-defeat';

export type HandRevealBatchMode = 'reveal' | 'revoke';

export interface HandRevealDialogValue {
  readonly mode: HandRevealBatchMode;
  readonly audience: 'all' | readonly string[];
}

@Component({
  selector: 'app-hand-reveal-dialog',
  imports: [RuntimeTranslatePipe],
  templateUrl: './hand-reveal-dialog.component.html',
  styleUrl: './hand-reveal-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HandRevealDialogComponent implements OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly bodyScrollLock = inject(BodyScrollLockService);
  private initializedKey = '';

  readonly requestKey = input.required<string>();
  readonly ownerPlayerId = input.required<string>();
  readonly cardCount = input.required<number>();
  readonly players = input.required<readonly PlayerView[]>();
  readonly initialTarget = input<string>('all');
  readonly revokePlayerIds = input<readonly string[]>([]);
  readonly publicRevealSelected = input(false);
  readonly pending = input(false);
  readonly error = input<string | null>(null);

  readonly confirmed = output<HandRevealDialogValue>();
  readonly cancelled = output<void>();

  readonly mode = signal<HandRevealBatchMode>('reveal');
  readonly allPlayers = signal(true);
  readonly selectedPlayerIds = signal<ReadonlySet<string>>(new Set());
  readonly eligiblePlayers = computed(() => this.players().filter((player) =>
    player.id !== this.ownerPlayerId() && !playerIsDefeated(player),
  ));
  readonly canRevoke = computed(() => this.publicRevealSelected() || this.revokePlayerIds().length > 0);
  readonly availablePlayers = computed(() => {
    const eligible = this.eligiblePlayers();
    if (this.mode() !== 'revoke' || this.publicRevealSelected()) {
      return eligible;
    }
    const revealed = new Set(this.revokePlayerIds());
    return eligible.filter((player) => revealed.has(player.id));
  });
  readonly selectedCount = computed(() => this.allPlayers()
    ? this.availablePlayers().length
    : this.selectedPlayerIds().size,
  );
  readonly canConfirm = computed(() => !this.pending() && this.cardCount() > 0 && this.selectedCount() > 0);

  constructor() {
    this.bodyScrollLock.lock();
    effect(() => {
      const key = this.requestKey();
      const players = this.availablePlayers();
      if (!key || key === this.initializedKey || players.length === 0) {
        return;
      }
      this.initializedKey = key;
      const initialTarget = this.initialTarget();
      const selected = players.some((player) => player.id === initialTarget) ? new Set([initialTarget]) : new Set<string>();
      this.allPlayers.set(initialTarget === 'all' || selected.size === 0);
      this.selectedPlayerIds.set(selected);
      queueMicrotask(() => this.focusInitialControl());
    });
  }

  ngOnDestroy(): void {
    this.bodyScrollLock.unlock();
  }

  setMode(mode: HandRevealBatchMode): void {
    if (this.pending() || (mode === 'revoke' && !this.canRevoke())) {
      return;
    }
    this.mode.set(mode);
    this.allPlayers.set(true);
    this.selectedPlayerIds.set(new Set());
  }

  setAllPlayers(checked: boolean): void {
    if (this.pending()) {
      return;
    }
    this.allPlayers.set(checked);
    if (checked) {
      this.selectedPlayerIds.set(new Set());
    }
  }

  togglePlayer(playerId: string, checked: boolean): void {
    if (this.pending()) {
      return;
    }
    const next = new Set(this.selectedPlayerIds());
    checked ? next.add(playerId) : next.delete(playerId);
    this.selectedPlayerIds.set(next);
    this.allPlayers.set(false);
  }

  isPlayerSelected(playerId: string): boolean {
    return this.selectedPlayerIds().has(playerId);
  }

  confirm(): void {
    if (!this.canConfirm()) {
      return;
    }
    this.confirmed.emit({
      mode: this.mode(),
      audience: this.allPlayers() ? 'all' : this.availablePlayers()
        .map((player) => player.id)
        .filter((playerId) => this.selectedPlayerIds().has(playerId)),
    });
  }

  cancel(): void {
    if (!this.pending()) {
      this.cancelled.emit();
    }
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel();
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
    // A browser extension, an async update, or another overlay can move focus
    // outside the dialog without dispatching a focus event inside it. Treat
    // that state as a trap boundary too instead of allowing the next Tab to
    // escape into the table behind the modal.
    if (currentIndex < 0) {
      event.preventDefault();
      (event.shiftKey ? focusable[focusable.length - 1] : focusable[0])?.focus();
    } else if (event.shiftKey && currentIndex === 0) {
      event.preventDefault();
      focusable[focusable.length - 1]?.focus();
    } else if (!event.shiftKey && currentIndex === focusable.length - 1) {
      event.preventDefault();
      focusable[0]?.focus();
    }
  }

  private focusInitialControl(): void {
    this.host.nativeElement.querySelector<HTMLElement>('[data-hand-reveal-initial-focus]')?.focus();
  }

  private focusableElements(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hasAttribute('hidden'));
  }
}
