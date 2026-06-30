import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import {
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { BodyScrollLockService } from '../../../shared/services/body-scroll-lock.service';
import { PrettyScrollDirective } from '../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import {
  TableAssistantPlayer,
  TableAssistantPlayerArrangement,
} from '../models/table-assistant.models';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';
import { FormatSelectComponent, type FormatSelectOption } from '../../../shared/components/format-select/format-select.component';

type ArrangementModalMode = 'initial' | 'replay';

@Component({
  selector: 'app-table-assistant-replay-modal',
  imports: [RuntimeTranslatePipe, PrettyScrollDirective, ReactiveFormsModule, CzButtonDirective, FormatSelectComponent],
  templateUrl: './table-assistant-replay-modal.component.html',
  styleUrl: './table-assistant-replay-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableAssistantReplayModalComponent implements OnInit, OnDestroy {
  private readonly bodyScrollLock = inject(BodyScrollLockService);

  readonly players = input.required<readonly TableAssistantPlayer[]>();
  readonly mode = input<ArrangementModalMode>('replay');
  readonly closed = output<void>();
  readonly cancelled = output<void>();
  readonly replayConfirmed = output<TableAssistantPlayerArrangement>();

  readonly seatPositions = computed(() => this.players().map((_, index) => index));
  readonly seatColumnCount = computed(() => Math.max(1, Math.ceil(this.players().length / 2)));
  readonly turnIndexes = computed(() => this.players().map((_, index) => index));
  readonly confirmLabelKey = computed(() =>
    this.mode() === 'initial'
      ? 'tableAssistant.tableAssistantReplayModal.startGame'
      : 'common.actions.newGame',
  );
  private formInitialized = false;
  readonly arrangementForm = new FormGroup(
    {
      seats: new FormArray<FormControl<string | null>>([]),
      turns: new FormArray<FormControl<number | null>>([]),
    },
    { validators: () => (this.formInitialized ? this.arrangementValidationErrors() : null) },
  );

  ngOnInit(): void {
    this.bodyScrollLock.lock();
    this.buildArrangementForm();
  }

  ngOnDestroy(): void {
    this.bodyScrollLock.unlock();
  }

  get seatControls(): FormArray<FormControl<string | null>> {
    return this.arrangementForm.controls.seats;
  }

  get turnControls(): FormArray<FormControl<number | null>> {
    return this.arrangementForm.controls.turns;
  }

  seatControl(seatIndex: number): FormControl<string | null> {
    return this.seatControls.at(seatIndex);
  }

  turnControlForPlayer(playerId: string): FormControl<number | null> {
    return this.turnControls.at(this.playerIndex(playerId));
  }

  playerAtSeat(seatIndex: number): TableAssistantPlayer | null {
    const playerId = this.seatControl(seatIndex)?.value;
    return this.players().find((player) => player.id === playerId) ?? null;
  }

  setTurnIndex(playerId: string, rawIndex: string | number): void {
    const currentControl = this.turnControlForPlayer(playerId);
    if (rawIndex === '') {
      currentControl.setValue(null);
      this.arrangementForm.updateValueAndValidity();
      return;
    }

    const targetIndex = Number.parseInt(String(rawIndex), 10);
    const currentIndex = currentControl.value;

    if (
      !Number.isInteger(targetIndex) ||
      targetIndex < 0 ||
      targetIndex >= this.players().length ||
      targetIndex === currentIndex
    ) {
      return;
    }

    const displacedPlayer = this.players().find(
      (player) =>
        player.id !== playerId && this.turnControlForPlayer(player.id).value === targetIndex,
    );
    currentControl.setValue(targetIndex);
    if (displacedPlayer) {
      this.turnControlForPlayer(displacedPlayer.id).setValue(currentIndex);
    }

    this.arrangementForm.updateValueAndValidity();
  }

  seatPlayerChanged(seatIndex: number): void {
    const playerId = this.seatControl(seatIndex).value;
    if (!playerId) {
      this.arrangementForm.updateValueAndValidity();
      return;
    }

    this.clearDuplicateSeat(playerId, seatIndex);
    this.arrangementForm.updateValueAndValidity();
  }

  setSeatPlayer(seatIndex: number, playerId: string): void {
    this.seatControl(seatIndex).setValue(playerId || null);
    this.seatPlayerChanged(seatIndex);
  }

  seatValue(seatIndex: number): string {
    return this.seatControl(seatIndex).value ?? '';
  }

  seatPlayerOptions(seatIndex: number): readonly FormatSelectOption[] {
    return [
      { id: '', labelKey: 'tableAssistant.tableAssistantReplayModal.noPlayer' },
      ...this.players().map((player) => ({
        id: player.id,
        name: player.name,
        disabled: this.isPlayerSeatedElsewhere(player.id, seatIndex),
      })),
    ];
  }

  turnIndexValue(playerId: string): string {
    const turnIndex = this.turnIndex(playerId);
    return turnIndex === null ? '' : String(turnIndex);
  }

  turnIndexOptions(playerId: string): readonly FormatSelectOption[] {
    return [
      { id: '', name: '-' },
      ...this.turnIndexes().map((turnIndex) => ({
        id: String(turnIndex),
        name: String(turnIndex + 1),
        disabled: this.isTurnIndexSelectedElsewhere(turnIndex, playerId),
      })),
    ];
  }

  turnIndex(playerId: string): number | null {
    return this.turnControlForPlayer(playerId)?.value ?? null;
  }

  turnPosition(playerId: string): string | null {
    const turnIndex = this.turnIndex(playerId);
    return turnIndex === null ? null : String(turnIndex + 1);
  }

  isTopSeat(index: number): boolean {
    return !this.isOddLastSeat(index) && index % 2 === 0;
  }

  isBottomSeat(index: number): boolean {
    return !this.isOddLastSeat(index) && index % 2 === 1;
  }

  isOddLastSeat(index: number): boolean {
    return this.players().length % 2 === 1 && index === this.players().length - 1;
  }

  seatColumn(index: number): number {
    return Math.floor(index / 2) + 1;
  }

  isPlayerSeatedElsewhere(playerId: string, seatIndex: number): boolean {
    return this.seatControls.controls.some(
      (control, index) => index !== seatIndex && control.value === playerId,
    );
  }

  isTurnIndexSelectedElsewhere(turnIndex: number, playerId: string): boolean {
    return this.players().some(
      (player) => player.id !== playerId && this.turnControlForPlayer(player.id).value === turnIndex,
    );
  }

  isArrangementComplete(): boolean {
    return this.arrangementForm.valid;
  }

  canRandomizeTurnOrder(): boolean {
    return this.hasCompleteSeats();
  }

  randomizeTurnOrder(): void {
    if (!this.canRandomizeTurnOrder()) {
      return;
    }

    this.turnControls.reset(this.emptyTurnValues(), { emitEvent: false });
    this.turnControls.setValue(this.randomTurnValuesByPlayerIndex(this.seatOrderFromForm()));
    this.arrangementForm.updateValueAndValidity();
  }

  confirmReplay(): void {
    if (!this.isArrangementComplete()) {
      return;
    }

    this.replayConfirmed.emit({
      seatOrder: this.seatOrderFromForm(),
      turnOrder: this.turnOrderFromForm(),
    });
  }

  close(): void {
    if (this.mode() === 'initial') {
      this.cancel();
      return;
    }

    this.closed.emit();
  }

  cancel(): void {
    this.cancelled.emit();
  }

  private buildArrangementForm(): void {
    this.seatControls.clear({ emitEvent: false });
    this.turnControls.clear({ emitEvent: false });

    const playersBySeat = new Map(this.players().map((player) => [player.seatIndex, player.id]));

    this.players().forEach((_, index) => {
      this.seatControls.push(
        new FormControl<string | null>(this.initialSeatValue(index, playersBySeat), {
          validators: Validators.required,
        }),
        { emitEvent: false },
      );
      this.turnControls.push(
        new FormControl<number | null>(null, {
          validators: Validators.required,
        }),
        { emitEvent: false },
      );
    });

    this.arrangementForm.updateValueAndValidity();
    this.formInitialized = true;
    this.arrangementForm.updateValueAndValidity();
  }

  private arrangementValidationErrors(): ValidationErrors | null {
    return this.hasCompleteSeats() && this.hasCompleteTurns()
      ? null
      : { incompleteArrangement: true };
  }

  private hasCompleteSeats(): boolean {
    const expectedPlayerIds = new Set(this.players().map((player) => player.id));
    const seatOrder = this.seatOrderFromForm();
    return (
      seatOrder.length === expectedPlayerIds.size &&
      new Set(seatOrder).size === expectedPlayerIds.size &&
      seatOrder.every((playerId) => expectedPlayerIds.has(playerId))
    );
  }

  private hasCompleteTurns(): boolean {
    const turnIndexes = this.turnControls.controls.map((control) => control.value);
    const expectedTurnIndexes = new Set(this.turnIndexes());
    return (
      turnIndexes.length === expectedTurnIndexes.size &&
      turnIndexes.every(
        (turnIndex) =>
          turnIndex !== null &&
          expectedTurnIndexes.has(turnIndex) &&
          turnIndexes.filter((candidate) => candidate === turnIndex).length === 1,
      )
    );
  }

  private seatOrderFromForm(): string[] {
    return this.seatControls.controls
      .map((control) => control.value)
      .filter((playerId): playerId is string => playerId !== null);
  }

  private turnOrderFromForm(): string[] {
    return this.players()
      .map((player, index) => ({
        playerId: player.id,
        turnIndex: this.turnControls.at(index).value,
      }))
      .filter(
        (playerTurn): playerTurn is { playerId: string; turnIndex: number } =>
          playerTurn.turnIndex !== null,
      )
      .sort((left, right) => left.turnIndex - right.turnIndex)
      .map((playerTurn) => playerTurn.playerId);
  }

  private initialSeatValue(index: number, playersBySeat: Map<number, string>): string | null {
    return this.mode() === 'initial' ? null : (playersBySeat.get(index) ?? null);
  }

  private emptyTurnValues(): null[] {
    return this.players().map(() => null);
  }

  private randomTurnValuesByPlayerIndex(seatedPlayerIds: string[]): Array<number | null> {
    const turnByPlayerId = new Map<string, number>();
    this.shufflePlayerIds(seatedPlayerIds).forEach((playerId, turnIndex) => {
      turnByPlayerId.set(playerId, turnIndex);
    });

    return this.players().map((player) => turnByPlayerId.get(player.id) ?? null);
  }

  private shufflePlayerIds(playerIds: string[]): string[] {
    const shuffledPlayerIds = [...playerIds];
    for (let index = shuffledPlayerIds.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffledPlayerIds[index], shuffledPlayerIds[swapIndex]] = [
        shuffledPlayerIds[swapIndex],
        shuffledPlayerIds[index],
      ];
    }

    return shuffledPlayerIds;
  }

  private clearDuplicateSeat(playerId: string, selectedSeatIndex: number): void {
    this.seatControls.controls.forEach((control, seatIndex) => {
      if (seatIndex !== selectedSeatIndex && control.value === playerId) {
        control.setValue(null);
      }
    });
  }

  private playerIndex(playerId: string): number {
    const index = this.players().findIndex((player) => player.id === playerId);
    if (index === -1) {
      throw new Error(`Unknown table assistant player: ${playerId}`);
    }

    return index;
  }
}
