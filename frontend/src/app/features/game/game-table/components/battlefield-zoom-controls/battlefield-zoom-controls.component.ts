import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ManaIconComponent } from '../../../../../shared/mana/mana-icon/mana-icon.component';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { type BattlefieldZoomPercent } from '../../state/battlefield/game-table-battlefield-zoom.state';

const ZOOM_THUMB_MANA_SYMBOL_CLASSES = [
  'ms-w',
  'ms-u',
  'ms-b',
  'ms-r',
  'ms-g',
  'ms-wu',
  'ms-wb',
  'ms-ub',
  'ms-ur',
  'ms-br',
  'ms-bg',
  'ms-rw',
  'ms-rg',
  'ms-gw',
  'ms-gu',
  'ms-2w',
  'ms-2u',
  'ms-2b',
  'ms-2r',
  'ms-2g',
  'ms-cw',
  'ms-cu',
  'ms-cb',
  'ms-cr',
  'ms-cg',
  'ms-wp',
  'ms-up',
  'ms-bp',
  'ms-rp',
  'ms-gp',
  'ms-wup',
  'ms-wbp',
  'ms-ubp',
  'ms-urp',
  'ms-brp',
  'ms-bgp',
  'ms-rwp',
  'ms-rgp',
  'ms-gwp',
  'ms-gup',
  'ms-s',
] as const;
const DEFAULT_ZOOM_SNAP_DISTANCE_PERCENT = 2;

@Component({
  selector: 'app-battlefield-zoom-controls',
  imports: [RuntimeTranslatePipe, LucideAngularModule, ManaIconComponent],
  templateUrl: './battlefield-zoom-controls.component.html',
  styleUrl: './battlefield-zoom-controls.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BattlefieldZoomControlsComponent {
  private readonly hostElement = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly zoomPercent = input.required<BattlefieldZoomPercent>();
  readonly minZoomPercent = input.required<number>();
  readonly maxZoomPercent = input.required<number>();
  readonly defaultZoomPercent = input.required<number>();
  readonly zoomStepPercent = input.required<number>();
  readonly canResetZoom = input.required<boolean>();

  readonly zoomPercentChanged = output<BattlefieldZoomPercent>();
  readonly resetZoom = output<void>();
  readonly isExpanded = signal(false);
  readonly zoomThumbSymbol = this.pickRandomManaSymbolClass();
  readonly currentZoomPosition = computed(() => this.sliderPosition(this.zoomPercent()));
  readonly defaultZoomPosition = computed(() => this.sliderPosition(this.defaultZoomPercent()));
  private isSliderDragging = false;

  @HostListener('document:pointerdown', ['$event'])
  closeWhenClickingOutside(event: PointerEvent): void {
    if (!this.isExpanded()) {
      return;
    }

    const target = event.target instanceof Node ? event.target : null;
    if (target !== null && this.hostElement.nativeElement.contains(target)) {
      return;
    }

    this.isExpanded.set(false);
  }

  toggleExpanded(): void {
    this.isExpanded.update((isExpanded) => !isExpanded);
  }

  startSliderDrag(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }

    this.isSliderDragging = true;
    const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    target?.setPointerCapture?.(event.pointerId);
    this.emitZoomFromPointer(event);
  }

  moveSliderDrag(event: PointerEvent): void {
    if (!this.isSliderDragging) {
      return;
    }

    this.emitZoomFromPointer(event);
  }

  endSliderDrag(event: PointerEvent): void {
    if (!this.isSliderDragging) {
      return;
    }

    this.emitZoomFromPointer(event);
    this.cancelSliderDrag();
  }

  cancelSliderDrag(): void {
    this.isSliderDragging = false;
  }

  private pickRandomManaSymbolClass(): (typeof ZOOM_THUMB_MANA_SYMBOL_CLASSES)[number] {
    const randomValues = globalThis.crypto?.getRandomValues?.(new Uint32Array(1));
    const index =
      randomValues !== undefined
        ? (randomValues[0] ?? 0) % ZOOM_THUMB_MANA_SYMBOL_CLASSES.length
        : Math.floor(Math.random() * ZOOM_THUMB_MANA_SYMBOL_CLASSES.length);

    return ZOOM_THUMB_MANA_SYMBOL_CLASSES[index] ?? ZOOM_THUMB_MANA_SYMBOL_CLASSES[0];
  }

  private sliderPosition(value: number): string {
    const range = this.maxZoomPercent() - this.minZoomPercent();
    if (range <= 0) {
      return '50%';
    }

    const ratio = Math.max(0, Math.min(1, (value - this.minZoomPercent()) / range));

    return `${Number((ratio * 100).toFixed(3))}%`;
  }

  handleZoomInput(event: Event): void {
    const inputElement = event.target instanceof HTMLInputElement ? event.target : null;
    const rawPercent = Number(inputElement?.value);
    if (!Number.isFinite(rawPercent)) {
      return;
    }

    const nextPercent = this.applyDefaultZoomSnap(rawPercent);
    if (inputElement !== null && nextPercent !== rawPercent) {
      inputElement.value = String(nextPercent);
    }

    this.zoomPercentChanged.emit(nextPercent);
  }

  private emitZoomFromPointer(event: PointerEvent): void {
    const shell = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const track = shell?.querySelector<HTMLElement>('.zoom-track') ?? null;
    if (!shell || !track) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const trackRect = track.getBoundingClientRect();
    const ratio = trackRect.width > 0
      ? Math.max(0, Math.min(1, (event.clientX - trackRect.left) / trackRect.width))
      : 0;
    const rawPercent = this.minZoomPercent() + ratio * (this.maxZoomPercent() - this.minZoomPercent());
    const nextPercent = this.applyDefaultZoomSnap(rawPercent);
    const input = shell.querySelector<HTMLInputElement>('.zoom-slider');
    if (input) {
      input.value = String(nextPercent);
    }
    this.zoomPercentChanged.emit(nextPercent);
  }

  private applyDefaultZoomSnap(value: number): BattlefieldZoomPercent {
    const defaultZoomPercent = this.defaultZoomPercent();
    const snappedValue =
      Math.abs(value - defaultZoomPercent) <= DEFAULT_ZOOM_SNAP_DISTANCE_PERCENT ? defaultZoomPercent : value;

    return Math.round(snappedValue) as BattlefieldZoomPercent;
  }
}
