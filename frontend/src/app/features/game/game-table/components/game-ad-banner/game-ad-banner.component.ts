import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-game-ad-banner',
  templateUrl: './game-ad-banner.component.html',
  styleUrl: './game-ad-banner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameAdBannerComponent {}
