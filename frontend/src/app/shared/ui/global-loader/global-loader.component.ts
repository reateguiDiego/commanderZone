import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-global-loader',
  templateUrl: './global-loader.component.html',
  styleUrl: './global-loader.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalLoaderComponent {}
