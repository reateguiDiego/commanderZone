import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import {
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import {
  TableAssistantPlayer,
  TableAssistantPlayerArrangement,
} from '../models/table-assistant.models';

type ArrangementModalMode = 'initial' | 'replay';

@Component({
  selector: 'app-table-assistant-replay-modal',
  imports: [LucideAngularModule, ReactiveFormsModule],
  templateUrl: './table-assistant-replay-modal.component.html',
  styleUrl: './table-assistant-replay-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableAssistantReplayModalComponent implements OnInit {
  readonly players = input.required<readonly TableAssistantPlayer[]>();
  readonly mode = input<ArrangementModalMode>('replay');
  readonly closed = output<void>();
  readonly cancelled = output<void>();
  readonly replayConfirmed = output<TableAssistantPlayerArrangement>();

  readonly draggedSeatIndex = signal<number | null>(null);
  readonly selectedSeatIndex = signal<number | null>(null);
  readonly seatPositions = computed(() => this.players().map((_, index) => index));
  readonly seatColumnCount = computed(() => Math.max(1, Math.ceil(this.players().length / 2)));
  readonly turnIndexes = computed(() => this.players().map((_, index) => index));
  readonly confirmLabel = computed(() =>
    this.mode() === 'initial' ? 'Empezar partida' : 'Nueva partida',
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
    this.buildArrangementForm();
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

  selectSeatCell(seatIndex: number): void {
    const selectedIndex = this.selectedSeatIndex();
    if (selectedIndex === null) {
      this.selectedSeatIndex.set(seatIndex);
      return;
    }

    if (selectedIndex === seatIndex) {
      this.selectedSeatIndex.set(null);
      return;
    }

    this.swapSeatAssignments(selectedIndex, seatIndex);
    this.selectedSeatIndex.set(null);
  }

  startSeatDrag(event: DragEvent, seatIndex: number): void {
    if (!this.playerAtSeat(seatIndex)) {
      event.preventDefault();
      return;
    }

    this.startDrag(event, seatIndex);
    this.draggedSeatIndex.set(seatIndex);
  }

  allowDrop(event: DragEvent): void {
    event.preventDefault();

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  dropOnSeat(event: DragEvent, targetSeatIndex: number): void {
    event.preventDefault();

    const draggedSeatIndex = this.draggedSeat(event, this.draggedSeatIndex());
    if (draggedSeatIndex === null || draggedSeatIndex === targetSeatIndex) {
      this.endDrag();
      return;
    }

    this.swapSeatAssignments(draggedSeatIndex, targetSeatIndex);
    this.endDrag();
  }

  endDrag(): void {
    this.draggedSeatIndex.set(null);
  }

  moveTurnPlayer(playerId: string, direction: -1 | 1): void {
    const currentIndex = this.turnIndex(playerId);
    const targetIndex = currentIndex === null ? null : currentIndex + direction;

    if (
      currentIndex === null ||
      targetIndex === null ||
      targetIndex < 0 ||
      targetIndex >= this.players().length
    ) {
      return;
    }

    this.setTurnIndex(playerId, targetIndex);
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

  turnIndex(playerId: string): number | null {
    return this.turnControlForPlayer(playerId)?.value ?? null;
  }

  turnPosition(playerId: string): string {
    const turnIndex = this.turnIndex(playerId);
    return turnIndex === null ? '-' : String(turnIndex + 1);
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

  nextPlayerName(playerId: string): string {
    const turnOrder = this.turnOrderFromForm();
    const playerIndex = turnOrder.indexOf(playerId);
    if (playerIndex === -1 || turnOrder.length !== this.players().length) {
      return 'pendiente';
    }

    const nextPlayerId = turnOrder[(playerIndex + 1) % turnOrder.length];
    const nextPlayer = this.players().find((player) => player.id === nextPlayerId);
    return nextPlayer?.name ?? 'pendiente';
  }

  isPlayerSeatedElsewhere(playerId: string, seatIndex: number): boolean {
    return this.seatControls.controls.some(
      (control, index) => index !== seatIndex && control.value === playerId,
    );
  }

  isArrangementComplete(): boolean {
    return this.arrangementForm.valid;
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

    const initialMode = this.mode() === 'initial';
    const playersBySeat = new Map(this.players().map((player) => [player.seatIndex, player.id]));

    this.players().forEach((player, index) => {
      this.seatControls.push(
        new FormControl<string | null>(initialMode ? null : (playersBySeat.get(index) ?? null), {
          validators: Validators.required,
        }),
        { emitEvent: false },
      );
      this.turnControls.push(
        new FormControl<number | null>(initialMode ? null : player.turnOrder, {
          validators: Validators.required,
        }),
        { emitEvent: false },
      );
    });

    this.arrangementForm.updateValueAndValidity();
    this.formInitialized = true;
    this.arrangementForm.updateValueAndValidity();
  }

  private startDrag(event: DragEvent, seatIndex: number): void {
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(seatIndex));
    }
  }

  private draggedSeat(event: DragEvent, fallbackSeatIndex: number | null): number | null {
    const rawSeatIndex = event.dataTransfer?.getData('text/plain');
    const seatIndex = rawSeatIndex ? Number.parseInt(rawSeatIndex, 10) : fallbackSeatIndex;
    return Number.isInteger(seatIndex) ? seatIndex : null;
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

  private swapSeatAssignments(leftIndex: number, rightIndex: number): void {
    const leftControl = this.seatControl(leftIndex);
    const rightControl = this.seatControl(rightIndex);
    const leftPlayerId = leftControl.value;

    leftControl.setValue(rightControl.value);
    rightControl.setValue(leftPlayerId);
    this.arrangementForm.updateValueAndValidity();
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
