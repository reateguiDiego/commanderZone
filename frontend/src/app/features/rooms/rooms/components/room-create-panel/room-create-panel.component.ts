import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { DeckFormat } from '../../../../../core/models/deck.model';
import { RoomVisibility } from '../../../../../core/models/room.model';
import { VisibilityChoiceComponent } from '../../../../../shared/components/visibility-choice/visibility-choice.component';
import { FormatSelectComponent } from '../../../../../shared/components/format-select/format-select.component';

export interface RoomCreatePayload {
  name: string;
  maxPlayers: number;
  visibility: RoomVisibility;
  format: string;
}

@Component({
  selector: 'app-room-create-panel',
  imports: [ReactiveFormsModule, LucideAngularModule, VisibilityChoiceComponent, FormatSelectComponent],
  templateUrl: './room-create-panel.component.html',
  styleUrl: './room-create-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoomCreatePanelComponent {
  private readonly formBuilder = inject(FormBuilder);

  readonly lockedRoomTooltip = 'You are already in a room. Leave it before joining another one.';
  readonly formats = input<readonly DeckFormat[]>([]);
  readonly actionsLocked = input(false);
  readonly codeJoinRequested = output<string>();
  readonly roomCreated = output<RoomCreatePayload>();
  readonly maxPlayersOptions = [2, 3, 4, 5, 6] as const;
  readonly roomCode = signal('');
  readonly createRoomForm = this.formBuilder.group({
    roomName: ['', [Validators.required, Validators.maxLength(120)]],
    format: ['commander', [Validators.required]],
    players: [null as number | null, [Validators.required]],
    privacy: [null as RoomVisibility | null, [Validators.required]],
  });

  constructor() {
    effect(() => {
      const formats = this.formats();
      const selectedFormat = this.createRoomForm.controls.format.value;
      if (formats.length > 0 && !formats.some((format) => format.id === selectedFormat)) {
        this.createRoomForm.controls.format.setValue(formats[0].id);
      }
    });
  }

  setRoomCode(event: Event): void {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    this.roomCode.set(input?.value ?? '');
  }

  joinByCode(): void {
    if (this.actionsLocked()) {
      return;
    }

    const code = this.roomCode().trim();
    if (!code) {
      return;
    }

    this.codeJoinRequested.emit(code);
  }

  submit(): void {
    if (this.actionsLocked() || this.createRoomForm.invalid) {
      this.createRoomForm.markAllAsTouched();
      return;
    }

    const roomName = (this.createRoomForm.value.roomName ?? '').trim();
    const format = (this.createRoomForm.value.format ?? '').trim();
    const players = this.createRoomForm.value.players;
    const privacy = this.createRoomForm.value.privacy;
    if (!roomName || !format || players == null || privacy == null) {
      this.createRoomForm.markAllAsTouched();
      return;
    }

    this.roomCreated.emit({
      name: roomName,
      maxPlayers: players,
      visibility: privacy,
      format,
    });
  }
}
