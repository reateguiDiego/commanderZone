import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

interface ZoneCardStackLayer {
  key: number;
  zIndex: number;
  offset: number;
}

@Component({
  selector: 'app-zone-card-stack',
  templateUrl: './zone-card-stack.component.html',
  styleUrl: './zone-card-stack.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZoneCardStackComponent {
  private readonly maxVisualCards = 10;

  readonly image = input.required<string>();
  readonly layerImage = input<string | null>(null);
  readonly label = input.required<string>();
  readonly count = input.required<number>();

  readonly stackLayers = computed(() => {
    const visualCardCount = this.layerImage() ? Math.min(this.maxVisualCards, Math.max(0, Math.floor(this.count()))) : 1;
    const layerCount = Math.max(0, visualCardCount - 1);
    const maxOffset = 7;

    return Array.from({ length: layerCount }, (_value, index): ZoneCardStackLayer => {
      const depthFromTop = index + 1;
      const normalizedDepth = layerCount <= 1 ? 1 : depthFromTop / layerCount;

      return {
        key: depthFromTop,
        zIndex: layerCount - index,
        offset: Math.round(maxOffset * normalizedDepth * 100) / 100,
      };
    });
  });
}
