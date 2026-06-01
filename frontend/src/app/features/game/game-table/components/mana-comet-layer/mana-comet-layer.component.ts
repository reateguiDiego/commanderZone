import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ManaSymbolsComponent } from '../../../../../shared/mana/mana-symbols/mana-symbols.component';
import { ManaPoolColor } from '../../utils/mana-source-detector';

export interface ManaCometEffect {
  readonly id: string;
  readonly color: ManaPoolColor;
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
  readonly angleDeg: number;
  readonly trailLength: number;
  readonly delayMs: number;
}

@Component({
  selector: 'app-mana-comet-layer',
  imports: [ManaSymbolsComponent],
  templateUrl: './mana-comet-layer.component.html',
  styleUrl: './mana-comet-layer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManaCometLayerComponent {
  readonly effects = input<readonly ManaCometEffect[]>([]);
}
