import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { PlayerView } from '../../game-table.store';
import { playerIsDefeated } from '../../utils/game-player-defeat';

export interface ArrowTargetDialogValue {
  readonly playerId: string;
  readonly multipleTargets: boolean;
  readonly targetCount: number;
}

@Component({
  selector: 'app-arrow-target-dialog',
  templateUrl: './arrow-target-dialog.component.html',
  styleUrl: './arrow-target-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArrowTargetDialogComponent {
  readonly players = input.required<readonly PlayerView[]>();
  readonly selectedPlayerId = input.required<string>();
  readonly multipleTargets = input(false);
  readonly targetCount = input(1);
  readonly playerLabel = input.required<(player: PlayerView) => string>();
  readonly availablePlayers = computed(() => this.players().filter((player) => !playerIsDefeated(player)));
  readonly effectiveSelectedPlayerId = computed(() => {
    const selectedPlayerId = this.selectedPlayerId();
    return this.availablePlayers().some((player) => player.id === selectedPlayerId)
      ? selectedPlayerId
      : this.availablePlayers()[0]?.id ?? selectedPlayerId;
  });
  readonly effectiveTargetCount = computed(() => this.normalizedTargetCount(this.multipleTargets(), this.targetCount()));

  readonly valueChanged = output<ArrowTargetDialogValue>();
  readonly confirmed = output<ArrowTargetDialogValue>();
  readonly cancelled = output<void>();

  updatePlayer(playerId: string): void {
    this.emitValue(playerId, this.multipleTargets(), this.targetCount());
  }

  updateMultipleTargets(multipleTargets: boolean): void {
    this.emitValue(this.effectiveSelectedPlayerId(), multipleTargets, this.targetCount());
  }

  updateTargetCount(value: string): void {
    this.emitValue(this.effectiveSelectedPlayerId(), this.multipleTargets(), Number(value));
  }

  confirm(): void {
    this.confirmed.emit({
      playerId: this.effectiveSelectedPlayerId(),
      multipleTargets: this.multipleTargets(),
      targetCount: this.effectiveTargetCount(),
    });
  }

  private emitValue(playerId: string, multipleTargets: boolean, targetCount: number): void {
    this.valueChanged.emit({
      playerId,
      multipleTargets,
      targetCount: this.normalizedTargetCount(multipleTargets, targetCount),
    });
  }

  private normalizedTargetCount(multipleTargets: boolean, targetCount: number): number {
    if (!multipleTargets) {
      return 1;
    }

    return Math.max(2, Math.floor(Number.isFinite(targetCount) ? targetCount : 2));
  }
}
