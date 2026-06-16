import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { GameSpecialEntity } from '../../../../../core/models/game.model';

export type SpecialEntityRailVariant = 'summary' | 'compact';

@Component({
  selector: 'app-special-entity-rail',
  imports: [RuntimeTranslatePipe],
  templateUrl: './special-entity-rail.component.html',
  styleUrl: './special-entity-rail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpecialEntityRailComponent {
  readonly entities = input.required<readonly GameSpecialEntity[]>();
  readonly variant = input<SpecialEntityRailVariant>('summary');
  readonly ringBearerName = input.required<(entity: GameSpecialEntity) => string | null>();

  readonly previewRequested = output<GameSpecialEntity>();
  readonly previewHidden = output<void>();
  readonly entityContextRequested = output<{ event: MouseEvent; entity: GameSpecialEntity }>();
  readonly nonCardEntities = computed(() => this.entities().filter((entity) => !entity.card));
  readonly cardEntities = computed(() => this.entities().filter((entity) => !!entity.card));

  mechanicIconClass(entity: GameSpecialEntity): string {
    return `special-entity-mana-icon ms ms-mechanic ${this.mechanicIcon(entity)}`;
  }

  private mechanicIcon(entity: GameSpecialEntity): string {
    switch (entity.template) {
      case 'monarch':
        return 'ms-ability-role-royal';
      case 'initiative':
        return 'ms-ability-d20';
      case 'citys_blessing':
        return 'ms-ability-ascend';
      case 'the_ring':
        return 'ms-ability-the-ring-tempts-you';
      case 'emblem':
        return 'ms-planeswalker';
      case 'day_night':
        return 'ms-ability-day-night';
      case 'dungeon':
      default:
        return 'ms-ability-dungeon';
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

  tooltipFor(entity: GameSpecialEntity, baseLabel: string): string {
    const details: string[] = [];

    if (entity.template === 'the_ring') {
      const level = this.ringLevel(entity);
      if (level !== null) {
        details.push(`Level ${level}`);
      }

      const bearer = this.ringBearerLabel(entity);
      if (bearer) {
        details.push(bearer);
      }
    }

    if (entity.template === 'dungeon') {
      const room = this.dungeonRoom(entity);
      if (room) {
        details.push(room);
      }
    }

    return details.length > 0 ? `${baseLabel} - ${details.join(' - ')}` : baseLabel;
  }

  requestEntityContext(event: MouseEvent, entity: GameSpecialEntity): void {
    if (entity.template !== 'citys_blessing') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.entityContextRequested.emit({ event, entity });
  }
}
