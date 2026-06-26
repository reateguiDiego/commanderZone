import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-global-loader',
  templateUrl: './global-loader.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalLoaderComponent {}
