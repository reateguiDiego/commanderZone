import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LandingInternalLinksContent } from '../../models/seo-landing-content.model';

@Component({
  selector: 'app-landing-internal-links',
  templateUrl: './landing-internal-links.component.html',
  styleUrl: './landing-internal-links.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingInternalLinksComponent {
  readonly content = input.required<LandingInternalLinksContent>();
}
