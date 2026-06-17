import { ChangeDetectionStrategy, Component, HostBinding, computed, input, output } from '@angular/core';
import { GameSpecialEntity } from '../../../../../core/models/game.model';
import { SpecialEntityRailComponent } from '../special-entity-rail/special-entity-rail.component';
import { visibleSpecialEntityRailEntities } from '../../utils/special-entity-rail-visibility';

export type SpecialEntityStripVariant = 'summary' | 'compact';

@Component({
  selector: 'app-special-entity-strip',
  imports: [SpecialEntityRailComponent],
  templateUrl: './special-entity-strip.component.html',
  styleUrl: './special-entity-strip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpecialEntityStripComponent {
  readonly variant = input<SpecialEntityStripVariant>('summary');
  readonly entities = input.required<readonly GameSpecialEntity[]>();

  readonly previewRequested = output<GameSpecialEntity>();
  readonly previewHidden = output<void>();
  readonly entityContextRequested = output<{ event: MouseEvent; entity: GameSpecialEntity }>();
  readonly visibleEntities = computed(() => visibleSpecialEntityRailEntities(this.entities()));
  readonly hasEntities = computed(() => this.visibleEntities().length > 0);

  @HostBinding('attr.data-variant')
  get hostVariant(): SpecialEntityStripVariant {
    return this.variant();
  }
}
