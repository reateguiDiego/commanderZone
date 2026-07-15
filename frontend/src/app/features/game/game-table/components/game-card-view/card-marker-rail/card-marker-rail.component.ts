import { RuntimeTranslatePipe } from '../../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, HostBinding, computed, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { resolveCardCounterLayout, type CardCounterLayout } from '../../../utils/card-counter-layout';

export interface CardMarkerCounter {
  readonly key: string;
  readonly value: number;
}

export interface CardMarkerCounterChange {
  readonly event: MouseEvent;
  readonly key: string;
  readonly delta: number;
}

export interface CardMarkerCounterDeleteRequest {
  readonly event: MouseEvent;
  readonly key: string;
}

type CounterMarkerKind = 'color' | 'stat' | 'generic';

interface CardMarkerCounterView extends CardMarkerCounter {
  readonly kind: CounterMarkerKind;
  readonly color: string | null;
  readonly label: string;
  readonly abbreviatedLabel: string;
}

const COLOR_COUNTER_STYLES: Record<string, string> = {
  black: '#0b0b0d',
  blue: '#2563eb',
  green: '#16a34a',
  red: '#dc2626',
  yellow: '#d7b46a',
};

@Component({
  selector: 'app-card-marker-rail',
  imports: [RuntimeTranslatePipe, LucideAngularModule],
  templateUrl: './card-marker-rail.component.html',
  styleUrl: './card-marker-rail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardMarkerRailComponent {
  readonly showTokenCopyMarker = input(false);
  readonly showRulingsMarker = input(false);
  readonly counters = input<readonly CardMarkerCounter[]>([]);
  readonly layout = input<CardCounterLayout | null>(null);
  readonly inline = input(false);
  readonly countersInteractive = input(true);
  readonly hasMarkers = computed(() => this.showTokenCopyMarker() || this.showRulingsMarker() || this.counters().length > 0);
  readonly markerCounters = computed<readonly CardMarkerCounterView[]>(() =>
    this.counters().map((counter) => this.counterView(counter)),
  );
  readonly resolvedLayout = computed<CardCounterLayout>(() => this.layout() ?? resolveCardCounterLayout({
    cardWidth: 116,
    cardHeight: 162,
    counterCount: this.counters().length,
    responsiveState: 'normal',
    tapped: false,
    relationRole: 'independent',
    availableRect: { width: 116, height: 162 },
  }));
  readonly counterChanged = output<CardMarkerCounterChange>();
  readonly counterDeleteRequested = output<CardMarkerCounterDeleteRequest>();
  readonly rulingsRequested = output<MouseEvent>();

  @HostBinding('class.inline-marker-rail')
  get inlineMarkerRail(): boolean {
    return this.inline();
  }

  changeCounter(event: MouseEvent, counter: CardMarkerCounterView, delta: number): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.countersInteractive()) {
      return;
    }

    if (delta < 0 && counter.value <= 0) {
      this.counterDeleteRequested.emit({ event, key: counter.key });
      return;
    }

    this.counterChanged.emit({ event, key: counter.key, delta });
  }

  stopMarkerPointer(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onMarkerPointerUp(event: PointerEvent, key: string): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.countersInteractive()) {
      return;
    }

    if (event.button === 0) {
      this.counterChanged.emit({ event, key, delta: 1 });
    }
  }

  onCounterKeyDown(event: KeyboardEvent, counter: CardMarkerCounterView): void {
    const increment = event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowUp' || event.key === '+' || event.key === '=';
    const decrement = event.key === 'ArrowDown' || event.key === '-' || event.key === '_';
    if (!increment && !decrement) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (!this.countersInteractive()) {
      return;
    }

    this.changeCounter(new MouseEvent(increment ? 'click' : 'contextmenu'), counter, increment ? 1 : -1);
  }

  swallowMouseEvent(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  requestRulings(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.rulingsRequested.emit(event);
  }

  private counterView(counter: CardMarkerCounter): CardMarkerCounterView {
    const key = counter.key.toLowerCase();
    const color = COLOR_COUNTER_STYLES[key] ?? null;
    if (color !== null) {
      return { ...counter, kind: 'color', color, label: key, abbreviatedLabel: key.slice(0, 1).toUpperCase() };
    }

    if (counter.key === '+1/+1' || counter.key === '-1/-1') {
      return { ...counter, kind: 'stat', color: null, label: counter.key, abbreviatedLabel: counter.key };
    }

    const label = counter.key.trim() || 'Counter';
    return {
      ...counter,
      kind: 'generic',
      color: null,
      label,
      abbreviatedLabel: label.length <= 5 ? label : label.slice(0, 3).toUpperCase(),
    };
  }
}
