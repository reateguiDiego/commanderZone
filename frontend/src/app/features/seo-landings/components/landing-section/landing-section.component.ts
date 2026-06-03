import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LandingSectionContent } from '../../models/seo-landing-content.model';

@Component({
  selector: 'app-landing-section',
  templateUrl: './landing-section.component.html',
  styleUrl: './landing-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingSectionComponent {
  readonly content = input.required<LandingSectionContent>();
}
