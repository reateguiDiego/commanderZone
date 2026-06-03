import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DeckFormat } from '../../../../core/models/deck.model';
import { RoomFormat, RoomTimerMode, RoomVisibility } from '../../../../core/models/room.model';
import { FormatSelectComponent } from '../../../../shared/components/format-select/format-select.component';
import { GameSetupLifeControlComponent } from '../../../../shared/components/game-setup-life-control/game-setup-life-control.component';
import { GameSetupSeatsControlComponent } from '../../../../shared/components/game-setup-seats-control/game-setup-seats-control.component';
import { VisibilityChoiceComponent } from '../../../../shared/components/visibility-choice/visibility-choice.component';
import { AppModalComponent } from '../../../../shared/ui/app-modal/app-modal.component';
import { TableAssistantTimerMode } from '../../../table-assistant/models/table-assistant.models';
import { TableAssistantTimerSettingsComponent } from '../../../table-assistant/table-assistant-timer-settings/table-assistant-timer-settings.component';
import { RoomSetupControlsComponent } from '../room-setup-controls/room-setup-controls.component';

export interface RoomCreatePayload {
  name: string;
  maxPlayers: number;
  startingLife: number;
  timerMode: RoomTimerMode;
  timerDurationSeconds: number;
  visibility: RoomVisibility;
  format: RoomFormat;
}

export type RoomSetupModalMode = 'create' | 'edit';

@Component({
  selector: 'app-room-setup-modal',
  imports: [RuntimeTranslatePipe, 
    AppModalComponent,
    FormatSelectComponent,
    GameSetupLifeControlComponent,
    GameSetupSeatsControlComponent,
    ReactiveFormsModule,
    RoomSetupControlsComponent,
    TableAssistantTimerSettingsComponent,
    VisibilityChoiceComponent,
  ],
  templateUrl: './room-setup-modal.component.html',
  styleUrl: './room-setup-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoomSetupModalComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = input(false);
  readonly mode = input<RoomSetupModalMode>('create');
  readonly formats = input<readonly DeckFormat[]>([]);
  readonly joinedPlayers = input(2);
  readonly maxPlayers = input(4);
  readonly startingLife = input(40);
  readonly timerMode = input<RoomTimerMode>('none');
  readonly timerDurationSeconds = input(300);
  readonly maxPlayersOptions = input<readonly number[]>([2, 3, 4, 5, 6]);
  readonly startingLifeStep = input(1);
  readonly actionsLocked = input(false);
  readonly readOnly = input(false);
  readonly updatingCapacity = input(false);
  readonly updatingStartingLife = input(false);
  readonly updatingTimer = input(false);

  readonly closed = output<void>();
  readonly createRequested = output<RoomCreatePayload>();
  readonly maxPlayersChange = output<number>();
  readonly startingLifeChange = output<number>();
  readonly timerModeChange = output<RoomTimerMode>();
  readonly timerDurationSecondsChange = output<number>();

  readonly createMaxPlayers = signal(4);
  readonly createStartingLife = signal(40);
  readonly createTimerMode = signal<RoomTimerMode>('none');
  readonly createTimerDurationSeconds = signal(300);
  readonly createRoomForm = this.formBuilder.group({
    roomName: ['', [Validators.required, Validators.maxLength(30)]],
    format: ['commander' as RoomFormat, [Validators.required]],
    privacy: [null as RoomVisibility | null, [Validators.required]],
  });

  readonly roomNameLength = signal(0);
  readonly title = computed(() => {
    if (this.mode() === 'create') {
      return 'Create room';
    }

    return 'Setup';
  });
  readonly message = computed(() => this.mode() === 'create'
    ? ''
    : this.readOnly() ? '' : 'Retoca la configuracion de la sala antes de empezar.');
  readonly createTimerSummary = computed(() => {
    if (this.createTimerMode() === 'none') {
      return 'No timer';
    }

    const minutes = Math.floor(this.createTimerDurationSeconds() / 60);
    const seconds = this.createTimerDurationSeconds() % 60;

    return seconds === 0 ? `${minutes} min` : `${minutes}:${seconds.toString().padStart(2, '0')}`;
  });

  constructor() {
    effect(() => {
      const formats = this.formats();
      const selectedFormat = this.createRoomForm.controls.format.value;
      if (formats.length > 0 && !formats.some((format) => format.id === selectedFormat)) {
        this.createRoomForm.controls.format.setValue(formats[0].id as RoomFormat);
      }
    });
    this.createRoomForm.controls.roomName.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.roomNameLength.set((value ?? '').length);
      });
  }

  submitCreate(): void {
    if (this.mode() !== 'create' || this.actionsLocked() || this.createRoomForm.invalid) {
      this.createRoomForm.markAllAsTouched();
      return;
    }

    const name = (this.createRoomForm.value.roomName ?? '').trim();
    const format = this.createRoomForm.value.format;
    const visibility = this.createRoomForm.value.privacy;
    if (!name || !format || !visibility) {
      this.createRoomForm.markAllAsTouched();
      return;
    }

    this.createRequested.emit({
      name,
      format,
      visibility,
      maxPlayers: this.createMaxPlayers(),
      startingLife: this.createStartingLife(),
      timerMode: this.createTimerMode(),
      timerDurationSeconds: this.createTimerDurationSeconds(),
    });
  }

  confirmPrimaryAction(): void {
    if (this.mode() === 'create') {
      this.submitCreate();
      return;
    }

    this.closed.emit();
  }

  changeCreateTimerMode(timerMode: TableAssistantTimerMode): void {
    this.createTimerMode.set(timerMode === 'turn' ? 'turn' : 'none');
  }
}
