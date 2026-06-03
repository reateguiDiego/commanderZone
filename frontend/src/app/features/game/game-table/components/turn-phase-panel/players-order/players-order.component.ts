import { RuntimeTranslatePipe } from '../../../../../../core/localization/runtime-translate.pipe';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  computed,
  inject,
  input,
} from '@angular/core';
import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';
import { PlayerView } from '../../../game-table.store';
import { playerIsDefeated } from '../../../utils/game-player-defeat';

gsap.registerPlugin(Flip);

interface PlayersOrderEntry {
  readonly id: string;
  readonly name: string;
  readonly turnLabel: string;
  readonly title: string;
  readonly isActive: boolean;
  readonly isCurrent: boolean;
  readonly isDefeated: boolean;
}

@Component({
  selector: 'app-players-order',
  imports: [RuntimeTranslatePipe],
  templateUrl: './players-order.component.html',
  styleUrl: './players-order.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlayersOrderComponent implements OnChanges, OnDestroy {
  readonly players = input.required<ReadonlyArray<PlayerView>>();
  readonly activePlayerId = input.required<string | null>();
  readonly currentPlayerId = input.required<string | null>();
  readonly turnNumber = input.required<number>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly ngZone = inject(NgZone);
  private playerOrderAnimationFrame: number | undefined;
  private preparedFlip: (() => void) | null = null;

  readonly entries = computed<PlayersOrderEntry[]>(() => {
    const players = this.players().filter((player) => !playerIsDefeated(player));
    const activePlayerId = this.activePlayerId();
    const activeIndex = players.findIndex((player) => player.id === activePlayerId);
    const turnOrder = activeIndex >= 0
      ? [...players.slice(activeIndex), ...players.slice(0, activeIndex)]
      : players;

    return turnOrder.map((player, turnDistance) => {
      const name = this.playerName(player);
      const isActive = player.id === activePlayerId;
      const isCurrent = player.id === this.currentPlayerId();

      return {
        id: player.id,
        name,
        turnLabel: this.turnLabel(turnDistance, this.turnNumber()),
        title: this.playerTitle(name, turnDistance),
        isActive,
        isCurrent,
        isDefeated: false,
      };
    });
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['activePlayerId']?.firstChange) {
      return;
    }

    if (changes['activePlayerId'] && this.orderCardElements().length > 1) {
      this.preparedFlip = this.preparePlayerOrderFlip();
      this.playPreparedFlip();
    }
  }

  ngOnDestroy(): void {
    if (this.playerOrderAnimationFrame !== undefined) {
      window.cancelAnimationFrame(this.playerOrderAnimationFrame);
    }

    Flip.killFlipsOf(this.orderCardElements(), true);
  }

  trackEntry(_index: number, entry: PlayersOrderEntry): string {
    return entry.id;
  }

  private turnLabel(index: number, turnNumber: number): string {
    if (index === 0) {
      return `Turno ${turnNumber}`;
    }

    return `En ${index}`;
  }

  private playerTitle(name: string, index: number): string {
    if (index === 0) {
      return `${name} tiene el turno`;
    }

    return `${name} esta a ${index} turno${index === 1 ? '' : 's'}`;
  }

  private playerName(player: PlayerView): string {
    return player.state.user.displayName.trim() || 'Unknown player';
  }

  private preparePlayerOrderFlip(): () => void {
    const elements = this.orderCardElements();
    if (elements.length <= 1 || this.prefersReducedMotion()) {
      return () => undefined;
    }

    Flip.killFlipsOf(elements, true);
    const state = Flip.getState(elements);

    return () => {
      if (this.playerOrderAnimationFrame !== undefined) {
        window.cancelAnimationFrame(this.playerOrderAnimationFrame);
      }

      this.playerOrderAnimationFrame = window.requestAnimationFrame(() => {
        this.playerOrderAnimationFrame = undefined;
        const currentElements = this.orderCardElements();
        if (currentElements.length <= 1) {
          return;
        }

        this.ngZone.runOutsideAngular(() => {
          Flip.killFlipsOf(currentElements, true);
          Flip.from(state, {
            absolute: false,
            duration: 0.72,
            ease: 'power3.out',
            nested: true,
            prune: true,
            scale: false,
            stagger: 0.025,
            targets: currentElements,
          });
        });
      });
    };
  }

  private playPreparedFlip(): void {
    const playFlip = this.preparedFlip;
    this.preparedFlip = null;
    playFlip?.();
  }

  private orderCardElements(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[data-player-order-card]'));
  }

  private prefersReducedMotion(): boolean {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }
}
