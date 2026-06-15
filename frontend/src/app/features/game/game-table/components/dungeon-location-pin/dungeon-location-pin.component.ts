import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';
import { GameCardDungeonMarker } from '../../../../../core/models/game.model';

@Component({
  selector: 'app-dungeon-location-pin',
  templateUrl: './dungeon-location-pin.component.html',
  styleUrl: './dungeon-location-pin.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'dungeon-location-pin',
    '[class.dungeon-location-pin-interactive]': 'interactive()',
    '[style.left.%]': 'marker().x * 100',
    '[style.top.%]': 'marker().y * 100',
    '[style.--cz-dungeon-pin-size]': 'size()',
    '[attr.role]': 'interactive() ? "button" : null',
    '[attr.tabindex]': 'interactive() ? "0" : null',
    '[attr.title]': 'interactive() ? label() : null',
    '[attr.aria-label]': 'interactive() ? label() : null',
    '[attr.aria-hidden]': 'interactive() ? null : "true"',
    '[attr.draggable]': '"false"',
  },
})
export class DungeonLocationPinComponent {
  readonly marker = input.required<GameCardDungeonMarker>();
  readonly interactive = input(false, { transform: booleanAttribute });
  readonly label = input('Dungeon marker');
  readonly size = input('clamp(1.55rem, calc(var(--game-card-view-width, 7.2rem) * 0.25), 2.15rem)');
}
