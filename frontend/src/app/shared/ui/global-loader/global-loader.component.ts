import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';

@Component({
  selector: 'app-global-loader',
  imports: [RuntimeTranslatePipe],
  templateUrl: './global-loader.component.html',
  styleUrl: './global-loader.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalLoaderComponent {}
