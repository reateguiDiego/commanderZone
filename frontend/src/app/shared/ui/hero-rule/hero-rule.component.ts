import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-hero-rule',
  templateUrl: './hero-rule.component.html',
  styleUrl: './hero-rule.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeroRuleComponent {}
