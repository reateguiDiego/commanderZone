import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { getLegalPath } from '../../../core/legal/legal-routes';

@Component({
  selector: 'app-noindex-footer-disclaimer',
  imports: [RouterLink],
  templateUrl: './noindex-footer-disclaimer.component.html',
  styleUrl: './noindex-footer-disclaimer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoindexFooterDisclaimerComponent {
  readonly currentYear = new Date().getFullYear();
  readonly contactPath = getLegalPath('contact', 'en');
}
