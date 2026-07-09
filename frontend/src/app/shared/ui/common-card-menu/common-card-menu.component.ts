import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { GameChangerIconComponent } from '../game-changer-icon/game-changer-icon.component';

export interface CommonCardMenuAction<ActionId extends string = string> {
  readonly id: ActionId;
  readonly label: string;
  readonly translateLabel?: boolean;
  readonly danger?: boolean;
  readonly disabled?: boolean;
}

@Component({
  selector: 'app-common-card-menu',
  imports: [RuntimeTranslatePipe, GameChangerIconComponent],
  templateUrl: './common-card-menu.component.html',
  styleUrl: './common-card-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommonCardMenuComponent<ActionId extends string = string> {
  readonly title = input<string | null>(null);
  readonly titleIsGameChanger = input(false);
  readonly translateTitle = input(false);
  readonly actions = input<readonly CommonCardMenuAction<ActionId>[]>([]);
  readonly top = input.required<number>();
  readonly left = input.required<number>();
  readonly actionSelected = output<ActionId>();

  handleAction(event: MouseEvent, actionId: ActionId): void {
    event.preventDefault();
    event.stopPropagation();
    this.actionSelected.emit(actionId);
  }
}
