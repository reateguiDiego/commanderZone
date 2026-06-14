import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { GameSpecialEntity } from '../../../../../core/models/game.model';

@Component({
  selector: 'app-special-entity-rail',
  imports: [RuntimeTranslatePipe, LucideAngularModule],
  templateUrl: './special-entity-rail.component.html',
  styleUrl: './special-entity-rail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpecialEntityRailComponent {
  readonly entities = input.required<readonly GameSpecialEntity[]>();
  readonly ringBearerName = input.required<(entity: GameSpecialEntity) => string | null>();
  readonly imageFor = input.required<(entity: GameSpecialEntity) => string | null>();

  readonly previewRequested = output<GameSpecialEntity>();
  readonly previewHidden = output<void>();
  readonly nonCardEntities = computed(() => this.entities().filter((entity) => !entity.card));
  readonly cardEntities = computed(() => this.entities().filter((entity) => !!entity.card));

  iconFor(entity: GameSpecialEntity): string {
    switch (entity.template) {
      case 'monarch':
        return 'crown';
      case 'initiative':
        return 'flag';
      case 'citys_blessing':
      case 'emblem':
        return 'sparkles';
      case 'the_ring':
        return 'circle';
      default:
        return 'library';
    }
  }

  labelFor(entity: GameSpecialEntity): string {
    return `game.specialHelpers.labels.${entity.template}`;
  }

  ringLevel(entity: GameSpecialEntity): number | null {
    return typeof entity.state['level'] === 'number' ? entity.state['level'] : null;
  }

  dungeonRoom(entity: GameSpecialEntity): string | null {
    return typeof entity.state['roomName'] === 'string' ? entity.state['roomName'] : null;
  }

  ringBearerLabel(entity: GameSpecialEntity): string | null {
    return this.ringBearerName()(entity);
  }

  previewImage(entity: GameSpecialEntity): string | null {
    return this.imageFor()(entity);
  }
}
