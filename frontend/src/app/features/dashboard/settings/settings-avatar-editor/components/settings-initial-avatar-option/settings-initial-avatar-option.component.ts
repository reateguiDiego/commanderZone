import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

@Component({
  selector: 'app-settings-initial-avatar-option',
  imports: [],
  templateUrl: './settings-initial-avatar-option.component.html',
  styleUrl: './settings-initial-avatar-option.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsInitialAvatarOptionComponent {
  readonly selected = input(false);
  readonly controlsOpen = input(false);
  readonly disabled = input(false);
  readonly letter = input('P');
  readonly backgroundColor = input('#edcd83');
  readonly textColor = input('#16120a');

  readonly active = computed(() => this.selected() && this.controlsOpen());

  readonly selectedRequested = output<void>();
  readonly interactionStarted = output<MouseEvent>();
  readonly letterChanged = output<string>();
  readonly backgroundColorChanged = output<string>();
  readonly textColorChanged = output<string>();

  openControls(event: MouseEvent): void {
    if (this.disabled()) {
      return;
    }

    this.interactionStarted.emit(event);
    this.selectedRequested.emit();
  }
}
