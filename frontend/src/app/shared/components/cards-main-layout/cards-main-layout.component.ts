import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-cards-main-layout',
  templateUrl: './cards-main-layout.component.html',
  styleUrl: './cards-main-layout.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardsMainLayoutComponent {}
