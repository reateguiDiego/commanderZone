import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LandingHeroContent } from '../../models/seo-landing-content.model';

@Component({
  selector: 'app-landing-hero',
  templateUrl: './landing-hero.component.html',
  styleUrl: './landing-hero.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingHeroComponent {
  readonly content = input.required<LandingHeroContent>();
}
