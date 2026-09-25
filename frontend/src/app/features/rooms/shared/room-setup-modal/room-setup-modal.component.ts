import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DeckFormat } from '../../../../core/models/deck.model';
import { RoomFormat, RoomMulliganRule, RoomTimerMode, RoomVisibility } from '../../../../core/models/room.model';
import { FormatSelectComponent } from '../../../../shared/components/format-select/format-select.component';
import { GameSetupLifeControlComponent } from '../../../../shared/components/game-setup-life-control/game-setup-life-control.component';
import { GameSetupSeatsControlComponent } from '../../../../shared/components/game-setup-seats-control/game-setup-seats-control.component';
import { VisibilityChoiceComponent } from '../../../../shared/components/visibility-choice/visibility-choice.component';
import { AppModalComponent } from '../../../../shared/ui/app-modal/app-modal.component';
import { ToggleComponent } from '../../../../shared/ui/toggle/toggle.component';
import { TableAssistantTimerMode } from '../../../table-assistant/models/table-assistant.models';
import { TableAssistantTimerSettingsComponent } from '../../../table-assistant/table-assistant-timer-settings/table-assistant-timer-settings.component';
import { RoomSetupControlsComponent } from '../room-setup-controls/room-setup-controls.component';

export interface RoomCreatePayload {
  name: string;
  maxPlayers: number;
  startingLife: number;
  timerMode: RoomTimerMode;
  timerDurationSeconds: number;
  mulliganRule: RoomMulliganRule;
  firstMulliganFree: boolean;
  visibility: RoomVisibility;
  format: RoomFormat;
}

export interface RoomSetupUpdatePayload {
  maxPlayers?: number;
  startingLife?: number;
  timerMode?: RoomTimerMode;
  timerDurationSeconds?: number;
  mulliganRule?: RoomMulliganRule;
  firstMulliganFree?: boolean;
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
    ToggleComponent,
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
  readonly mulliganRule = input<RoomMulliganRule>('LONDON');
  readonly firstMulliganFree = input(true);
  readonly maxPlayersOptions = input<readonly number[]>([2, 3, 4, 5, 6]);
  readonly startingLifeStep = input(1);
  readonly actionsLocked = input(false);
  readonly readOnly = input(false);
  readonly updatingCapacity = input(false);
  readonly updatingStartingLife = input(false);
  readonly updatingTimer = input(false);
  readonly updatingMulligan = input(false);

  readonly closed = output<void>();
  readonly createRequested = output<RoomCreatePayload>();
  readonly updateRequested = output<RoomSetupUpdatePayload>();

  readonly createMaxPlayers = signal(4);
  readonly createStartingLife = signal(40);
  readonly createTimerMode = signal<RoomTimerMode>('none');
  readonly createTimerDurationSeconds = signal(300);
  readonly createMulliganRule = signal<RoomMulliganRule>('LONDON');
  readonly createFirstMulliganFree = signal(true);
  readonly createFirstMulliganFreeTouched = signal(false);
  readonly createFormat = signal<RoomFormat>('commander');
  readonly editMaxPlayers = signal(4);
  readonly editStartingLife = signal(40);
  readonly editTimerMode = signal<RoomTimerMode>('none');
  readonly editTimerDurationSeconds = signal(300);
  readonly editMulliganRule = signal<RoomMulliganRule>('LONDON');
  readonly editFirstMulliganFree = signal(true);
  readonly startingLifePresets: readonly number[] = [20, 40, 60];
  readonly startingLifeSliderHints: readonly number[] = [1, 20, 40, 60, 80, 99];
  readonly mulliganOptions: readonly { value: RoomMulliganRule; labelKey: string }[] = [
    { value: 'LONDON', labelKey: 'shared.text.london' },
    { value: 'VANCOUVER', labelKey: 'shared.text.vancouver' },
    { value: 'PARIS', labelKey: 'shared.text.paris' },
    { value: 'GENEROUS', labelKey: 'shared.text.generous' },
  ];
  readonly mulliganSelectOptions = computed(() => this.mulliganOptions.map((option) => ({
    id: option.value,
    labelKey: option.labelKey,
  })));
  readonly createRoomForm = this.formBuilder.group({
    roomName: ['', [Validators.required, Validators.maxLength(30)]],
    format: ['commander' as RoomFormat, [Validators.required]],
    privacy: ['public' as RoomVisibility, [Validators.required]],
  });

  readonly roomNameLength = signal(0);
  readonly title = computed(() => {
    if (this.mode() === 'create') {
      return 'shared.text.createRoom';
    }

    return 'rooms.waitingRoom.setup';
  });
  readonly message = computed(() => this.mode() === 'create'
    ? ''
    : this.readOnly() ? '' : 'rooms.roomSetupModal.editRoomConfigurationBeforeStarting');
  readonly createTimerSummary = computed(() => {
    if (this.createTimerMode() === 'none') {
      return 'rooms.roomSetupControls.noTimer';
    }

    const minutes = Math.floor(this.createTimerDurationSeconds() / 60);
    const seconds = this.createTimerDurationSeconds() % 60;

    return seconds === 0 ? `${minutes} min` : `${minutes}:${seconds.toString().padStart(2, '0')}`;
  });
  readonly createMulliganDescriptionKey = computed(() => this.descriptionKeyForMulliganRule(this.createMulliganRule()));
  readonly editChanges = computed<RoomSetupUpdatePayload>(() => {
    const changes: RoomSetupUpdatePayload = {};

    if (this.editMaxPlayers() !== this.maxPlayers()) {
      changes.maxPlayers = this.editMaxPlayers();
    }
    if (this.editStartingLife() !== this.startingLife()) {
      changes.startingLife = this.editStartingLife();
    }
    if (this.editTimerMode() !== this.timerMode()) {
      changes.timerMode = this.editTimerMode();
    }
    if (this.editTimerDurationSeconds() !== this.timerDurationSeconds()) {
      changes.timerDurationSeconds = this.editTimerDurationSeconds();
    }
    if (this.editMulliganRule() !== this.mulliganRule()) {
      changes.mulliganRule = this.editMulliganRule();
    }
    if (this.editFirstMulliganFree() !== this.firstMulliganFree()) {
      changes.firstMulliganFree = this.editFirstMulliganFree();
    }

    return changes;
  });
  readonly editHasChanges = computed(() => Object.keys(this.editChanges()).length > 0);
  private wasEditModalOpen = false;

  constructor() {
    effect(() => {
      const formats = this.formats();
      const selectedFormat = this.createFormat();
      if (formats.length > 0 && !formats.some((format) => format.id === selectedFormat)) {
        this.changeCreateFormat(formats[0].id as RoomFormat);
      }
    });
    effect(() => {
      const isEditModalOpen = this.mode() === 'edit' && this.open();
      if (isEditModalOpen && !this.wasEditModalOpen) {
        untracked(() => this.resetEditDraft());
      }
      this.wasEditModalOpen = isEditModalOpen;
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
      mulliganRule: this.createMulliganRule(),
      firstMulliganFree: this.createFirstMulliganFree(),
    });
  }

  confirmPrimaryAction(): void {
    if (this.mode() === 'create') {
      this.submitCreate();
      return;
    }

    const changes = this.editChanges();
    if (Object.keys(changes).length === 0) {
      return;
    }

    this.updateRequested.emit(changes);
    this.closed.emit();
  }

  changeCreateTimerMode(timerMode: TableAssistantTimerMode): void {
    this.createTimerMode.set(timerMode === 'turn' ? 'turn' : 'none');
  }

  changeCreateFormat(format: RoomFormat): void {
    this.createFormat.set(format);
    this.createRoomForm.controls.format.setValue(format);
    if (!this.createFirstMulliganFreeTouched()) {
      this.createFirstMulliganFree.set(this.defaultFirstMulliganFreeForFormat(format));
    }
  }

  changeCreateMulliganRule(mulliganRule: string): void {
    if (this.isRoomMulliganRule(mulliganRule)) {
      this.createMulliganRule.set(mulliganRule);
    }
  }

  changeCreateFirstMulliganFree(firstMulliganFree: boolean): void {
    this.createFirstMulliganFreeTouched.set(true);
    this.createFirstMulliganFree.set(firstMulliganFree);
  }

  private isRoomMulliganRule(mulliganRule: string): mulliganRule is RoomMulliganRule {
    return this.mulliganOptions.some((option) => option.value === mulliganRule);
  }

  private descriptionKeyForMulliganRule(mulliganRule: RoomMulliganRule): string {
    return `shared.text.mulliganDescriptions.${mulliganRule.toLowerCase()}`;
  }

  private defaultFirstMulliganFreeForFormat(format: RoomFormat): boolean {
    return format === 'commander';
  }

  private resetEditDraft(): void {
    this.editMaxPlayers.set(this.maxPlayers());
    this.editStartingLife.set(this.startingLife());
    this.editTimerMode.set(this.timerMode());
    this.editTimerDurationSeconds.set(this.timerDurationSeconds());
    this.editMulliganRule.set(this.mulliganRule());
    this.editFirstMulliganFree.set(this.firstMulliganFree());
  }
}
