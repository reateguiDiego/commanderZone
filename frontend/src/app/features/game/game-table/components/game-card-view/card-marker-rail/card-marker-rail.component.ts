import { RuntimeTranslatePipe } from '../../../../../../core/localization/runtime-translate.pipe';
import { CounterHoverIntentDirective } from '../../../directives/counter-hover-intent.directive';
import {
  ChangeDetectionStrategy,
  Component,
  HostBinding,
  OnChanges,
  computed,
  input,
  output,
  signal,
  type SimpleChanges,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

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
  readonly pulseClass: string | null;
}

type CounterPulseDirection = 'increase' | 'decrease';

interface CounterAnimationState {
  readonly direction: CounterPulseDirection;
  readonly revision: number;
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
  imports: [RuntimeTranslatePipe, LucideAngularModule, CounterHoverIntentDirective],
  templateUrl: './card-marker-rail.component.html',
  styleUrl: './card-marker-rail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardMarkerRailComponent implements OnChanges {
  readonly showTokenCopyMarker = input(false);
  readonly showRulingsMarker = input(false);
  readonly counters = input<readonly CardMarkerCounter[]>([]);
  readonly compact = input(false);
  readonly inline = input(false);
  readonly countersInteractive = input(true);
  readonly hasMarkers = computed(
    () => this.showTokenCopyMarker() || this.showRulingsMarker() || this.counters().length > 0,
  );
  private previousCounterValues = new Map<string, number>();
  private readonly counterAnimations = signal<ReadonlyMap<string, CounterAnimationState>>(
    new Map(),
  );
  readonly markerCounters = computed<readonly CardMarkerCounterView[]>(() => {
    const animations = this.counterAnimations();

    return this.counters().map((counter) => this.counterView(counter, animations.get(counter.key)));
  });
  readonly counterChanged = output<CardMarkerCounterChange>();
  readonly counterDeleteRequested = output<CardMarkerCounterDeleteRequest>();
  readonly rulingsRequested = output<MouseEvent>();

  @HostBinding('class.inline-marker-rail')
  get inlineMarkerRail(): boolean {
    return this.inline();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['counters']) {
      return;
    }

    const nextCounterValues = new Map(this.counters().map((counter) => [counter.key, counter.value]));
    const previousAnimations = this.counterAnimations();
    const nextAnimations = new Map<string, CounterAnimationState>();

    for (const [key, value] of nextCounterValues) {
      const previousValue = this.previousCounterValues.get(key);
      if (previousValue === undefined || previousValue === value) {
        continue;
      }

      const previousAnimation = previousAnimations.get(key);
      nextAnimations.set(key, {
        direction: value > previousValue ? 'increase' : 'decrease',
        revision: (previousAnimation?.revision ?? 0) + 1,
      });
    }

    this.previousCounterValues = nextCounterValues;
    this.counterAnimations.set(nextAnimations);
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

  swallowMouseEvent(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  requestRulings(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.rulingsRequested.emit(event);
  }

  private counterView(
    counter: CardMarkerCounter,
    animation: CounterAnimationState | undefined,
  ): CardMarkerCounterView {
    const key = counter.key.toLowerCase();
    const color = COLOR_COUNTER_STYLES[key] ?? null;
    if (color !== null) {
      return {
        ...counter,
        kind: 'color',
        color,
        label: key,
        pulseClass: this.pulseClass(animation),
      };
    }

    if (counter.key === '+1/+1' || counter.key === '-1/-1') {
      return {
        ...counter,
        kind: 'stat',
        color: null,
        label: counter.key,
        pulseClass: this.pulseClass(animation),
      };
    }

    return {
      ...counter,
      kind: 'generic',
      color: null,
      label: counter.key,
      pulseClass: this.pulseClass(animation),
    };
  }

  private pulseClass(animation: CounterAnimationState | undefined): string | null {
    if (!animation) {
      return null;
    }

    const phase = animation.revision % 2 === 0 ? 'b' : 'a';

    return `counter-marker-pulse-${animation.direction}-${phase}`;
  }
}
