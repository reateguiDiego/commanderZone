import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { TooltipComponent } from '../tooltip/tooltip.component';

@Component({
  selector: 'app-game-changer-icon',
  imports: [RuntimeTranslatePipe, TooltipComponent],
  templateUrl: './game-changer-icon.component.html',
  styleUrl: './game-changer-icon.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameChangerIconComponent {}
