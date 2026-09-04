import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { RuntimeTranslatePipe } from '../../../../core/localization/runtime-translate.pipe';
import { DeckEditorViewMode } from '../../models/deck-editor.models';

const VIEW_MODE_OPTIONS: readonly { value: DeckEditorViewMode; labelKey: string }[] = [
  { value: 'text', labelKey: 'shared.text.text' },
  { value: 'spoiler', labelKey: 'shared.text.spoiler' },
];

@Component({
  selector: 'app-deck-view-mode-select',
  imports: [LucideAngularModule, RuntimeTranslatePipe],
  templateUrl: './deck-view-mode-select.component.html',
  styleUrl: './deck-view-mode-select.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckViewModeSelectComponent {
  readonly value = input.required<DeckEditorViewMode>();
  readonly valueChange = output<DeckEditorViewMode>();
  readonly labelKey = input('shared.text.view');
  readonly idPrefix = input.required<string>();
  readonly menuOpen = signal(false);
  readonly options = VIEW_MODE_OPTIONS;
  readonly selectedLabelKey = computed(
    () =>
      this.options.find((option) => option.value === this.value())?.labelKey ?? 'shared.text.text',
  );
  readonly labelId = computed(() => `${this.idPrefix()}-label`);
  readonly valueId = computed(() => `${this.idPrefix()}-value`);

  @HostListener('document:click')
  @HostListener('window:scroll')
  @HostListener('window:resize')
  closeMenu(): void {
    this.menuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  closeMenuFromKeyboard(): void {
    this.closeMenu();
  }

  toggleMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.menuOpen.update((open) => !open);
  }

  select(value: DeckEditorViewMode, event: MouseEvent): void {
    event.stopPropagation();
    this.valueChange.emit(value);
    this.closeMenu();
  }
}
