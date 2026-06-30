import { NgTemplateOutlet } from '@angular/common';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { GameSpecialEntity } from '../../../../../core/models/game.model';
import { ManaIconComponent } from '../../../../../shared/mana/mana-icon/mana-icon.component';
import { visibleSpecialEntityRailEntities } from '../../utils/special-entity-rail-visibility';

export type SpecialEntityRailVariant = 'summary' | 'compact';

@Component({
  selector: 'app-special-entity-rail',
  imports: [NgTemplateOutlet, RuntimeTranslatePipe, ManaIconComponent],
  templateUrl: './special-entity-rail.component.html',
  styleUrl: './special-entity-rail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-variant]': 'variant()',
  },
})
export class SpecialEntityRailComponent {
  readonly entities = input.required<readonly GameSpecialEntity[]>();
  readonly variant = input<SpecialEntityRailVariant>('summary');

  readonly previewRequested = output<GameSpecialEntity>();
  readonly previewHidden = output<void>();
  readonly entityContextRequested = output<{ event: MouseEvent; entity: GameSpecialEntity }>();
  readonly visibleEntities = computed(() => visibleSpecialEntityRailEntities(this.entities()));
  readonly nonCardEntities = computed(() => this.visibleEntities().filter((entity) => !entity.card));
  readonly cardEntities = computed(() => this.visibleEntities().filter((entity) => !!entity.card));

  mechanicIcon(entity: GameSpecialEntity): string {
    switch (entity.template) {
      case 'monarch':
        return 'ms-ability-role-royal';
      case 'initiative':
        return 'ms-ability-d20';
      case 'citys_blessing':
        return 'ms-ability-ascend';
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
    switch (entity.template) {
      case 'citys_blessing':
        return 'game.specialHelpers.labels.citysBlessing';
      case 'day_night':
        return 'game.specialHelpers.labels.dayNight';
      case 'the_ring':
        return 'game.specialHelpers.labels.theRing';
      default:
        return `game.specialHelpers.labels.${entity.template}`;
    }
  }

  cardLabel(entity: GameSpecialEntity): string {
    if (entity.template === 'initiative') {
      return 'The Initiative';
    }

    return entity.card?.name ?? '';
  }

  dungeonRoom(entity: GameSpecialEntity): string | null {
    return typeof entity.state['roomName'] === 'string' ? entity.state['roomName'] : null;
  }

  tooltipFor(entity: GameSpecialEntity, baseLabel: string): string {
    const details: string[] = [];

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
