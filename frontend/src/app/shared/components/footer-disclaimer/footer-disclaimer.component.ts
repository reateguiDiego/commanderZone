import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { LegalLinksService } from '../../../core/legal/legal-links.service';
import { CookiePreferencesTriggerComponent } from '../../../core/privacy/cookie-preferences-trigger/cookie-preferences-trigger.component';

@Component({
  selector: 'app-footer-disclaimer',
  imports: [CookiePreferencesTriggerComponent],
  templateUrl: './footer-disclaimer.component.html',
  styleUrl: './footer-disclaimer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FooterDisclaimerComponent {
  private readonly legalLinks = inject(LegalLinksService);

  readonly copy = this.legalLinks.chromeCopy;
  readonly links = computed(() => this.copy().footer.links);
}
