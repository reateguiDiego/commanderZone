import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  OnDestroy,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  TABLE_ASSISTANT_COLOR_OPTIONS,
  tableAssistantColorOption,
} from '../domain/table-assistant-colors';
import { TableAssistantApi } from '../data-access/table-assistant.api';
import { TableAssistantTimerMode } from '../models/table-assistant.models';

@Component({
  selector: 'app-table-assistant-setup',
  imports: [FormsModule],
  templateUrl: './table-assistant-setup.component.html',
  styleUrl: './table-assistant-setup.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableAssistantSetupComponent implements OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly tableAssistantApi = inject(TableAssistantApi);
  private readonly router = inject(Router);

  readonly cancelled = output<void>();

  readonly colorOptions = TABLE_ASSISTANT_COLOR_OPTIONS;
  readonly timerMinuteOptions = Array.from({ length: 31 }, (_, index) => index);
  readonly timerSecondOptions = [0, 15, 30, 45];
  readonly playerCount = signal(4);
  readonly initialLife = signal(40);
  readonly playerNames = signal(['', '', '', '']);
  readonly playerColors = signal(['white', 'blue', 'black', 'red']);
  readonly timerMode = signal<TableAssistantTimerMode>('none');
  readonly timerDurationSeconds = signal(300);
  readonly openColorPickerIndex = signal<number | null>(null);
  readonly creating = signal(false);
  readonly error = signal<string | null>(null);

  readonly availableTimerModes = computed<TableAssistantTimerMode[]>(() => ['none', 'turn']);
  readonly canCreateRoom = computed(
    () =>
      !this.creating() &&
      this.playerCount() >= 2 &&
      this.playerNames()
        .slice(0, this.playerCount())
        .every((name) => name.trim() !== ''),
  );
  readonly timerDurationMinutes = computed(() => Math.floor(this.timerDurationSeconds() / 60));
  readonly timerDurationRemainderSeconds = computed(() => this.timerDurationSeconds() % 60);
  readonly timerDurationLabel = computed(
    () =>
      `${this.timerDurationMinutes()}:${this.timerDurationRemainderSeconds().toString().padStart(2, '0')}`,
  );

  ngOnDestroy(): void {
    this.cancelled.emit();
  }

  @HostListener('document:click', ['$event'])
  closeColorPickerFromOutside(event: MouseEvent): void {
    if (this.openColorPickerIndex() === null || !(event.target instanceof Element)) {
      return;
    }

    if (!this.host.nativeElement.contains(event.target) || !event.target.closest('.color-picker')) {
      this.openColorPickerIndex.set(null);
    }
  }

  setPlayerCount(value: string | number): void {
    const count = Math.min(6, Math.max(2, Number.parseInt(String(value), 10) || 4));
    this.playerCount.set(count);
    const names = [...this.playerNames()];
    while (names.length < count) {
      names.push('');
    }
    this.playerNames.set(names.slice(0, count));
    const colors = [...this.playerColors()];
    while (colors.length < count) {
      colors.push(this.colorOptions[colors.length % this.colorOptions.length].id);
    }
    this.playerColors.set(colors.slice(0, count));
  }

  setInitialLife(value: string | number): void {
    this.initialLife.set(Math.max(1, Number.parseInt(String(value), 10) || 40));
  }

  updatePlayerName(index: number, value: string): void {
    const names = [...this.playerNames()];
    names[index] = value;
    this.playerNames.set(names);
  }

  updatePlayerColor(index: number, color: string): void {
    if (!this.colorOptions.some((option) => option.id === color)) {
      return;
    }

    const colors = [...this.playerColors()];
    colors[index] = color;
    this.playerColors.set(colors);
  }

  setTimerMode(mode: string): void {
    const timerMode = mode as TableAssistantTimerMode;
    if (this.availableTimerModes().includes(timerMode)) {
      this.timerMode.set(timerMode);
    }
  }

  setTimerDurationMinutes(value: string | number): void {
    const minutes = this.normalizeWheelNumber(value);
    this.setTimerDurationParts(minutes, this.timerDurationRemainderSeconds());
  }

  setTimerDurationRemainderSeconds(value: string | number): void {
    const seconds = this.normalizeWheelNumber(value);
    this.setTimerDurationParts(this.timerDurationMinutes(), seconds);
  }

  colorLabel(colorId: string | undefined): string {
    return tableAssistantColorOption(colorId ?? this.colorOptions[0].id).label;
  }

  colorManaSymbols(colorId: string | undefined): readonly string[] {
    return tableAssistantColorOption(colorId ?? this.colorOptions[0].id).manaSymbols;
  }

  colorAccent(colorId: string | undefined): string {
    return tableAssistantColorOption(colorId ?? this.colorOptions[0].id).accent;
  }

  colorGradient(colorId: string | undefined): string {
    return tableAssistantColorOption(colorId ?? this.colorOptions[0].id).gradient;
  }

  manaClass(symbol: string): string {
    return `ms ms-${symbol}`;
  }

  toggleColorPicker(index: number): void {
    this.openColorPickerIndex.update((openIndex) => (openIndex === index ? null : index));
  }

  selectPlayerColor(index: number, color: string): void {
    this.updatePlayerColor(index, color);
    this.openColorPickerIndex.set(null);
  }

  async createRoom(): Promise<void> {
    if (!this.canCreateRoom()) {
      this.error.set('Necesitas al menos 2 jugadores y todos los nombres completos.');
      return;
    }

    this.creating.set(true);
    this.error.set(null);

    try {
      const response = await firstValueFrom(
        this.tableAssistantApi.create({
          mode: 'single-device',
          playerCount: this.playerCount(),
          initialLife: this.initialLife(),
          players: this.playerNames().map((name, index) => ({
            name: name.trim(),
            color: this.playerColors()[index] ?? this.colorOptions[0].id,
          })),
          phasesEnabled: false,
          timerMode: this.timerMode(),
          timerDurationSeconds: this.timerDurationSeconds(),
          skipEliminatedPlayers: false,
          activeTrackerIds: ['commander-damage'],
        }),
      );
      await this.router.navigate(['/table-assistant', response.tableAssistantRoom.id], {
        queryParams: { arrange: '1' },
      });
    } catch {
      this.error.set('No se pudo crear la sala de Asistente de Mesa.');
    } finally {
      this.creating.set(false);
    }
  }

  private setTimerDurationParts(minutes: number, seconds: number): void {
    const normalizedMinutes = Math.min(30, Math.max(0, minutes));
    const normalizedSeconds = this.timerSecondOptions.includes(seconds) ? seconds : 0;
    this.timerDurationSeconds.set(Math.max(30, normalizedMinutes * 60 + normalizedSeconds));
  }

  private normalizeWheelNumber(value: string | number): number {
    return Number.parseInt(String(value), 10) || 0;
  }
}
