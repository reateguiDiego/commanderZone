import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TooltipComponent } from '../tooltip/tooltip.component';

@Component({
  selector: 'app-game-changer-icon',
  imports: [TooltipComponent],
  templateUrl: './game-changer-icon.component.html',
  styleUrl: './game-changer-icon.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameChangerIconComponent {}
