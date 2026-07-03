import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PUBLIC_CONTACT_PATH } from '../../../core/contact/contact.config';
import { LegalLinksService } from '../../../core/legal/legal-links.service';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { CookiePreferencesTriggerComponent } from '../../../core/privacy/cookie-preferences-trigger/cookie-preferences-trigger.component';

@Component({
  selector: 'app-noindex-footer-disclaimer',
  imports: [CookiePreferencesTriggerComponent, RouterLink, RuntimeTranslatePipe],
  templateUrl: './noindex-footer-disclaimer.component.html',
  styleUrl: './noindex-footer-disclaimer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoindexFooterDisclaimerComponent {
  private readonly legalLinks = inject(LegalLinksService);

  readonly currentYear = new Date().getFullYear();
  readonly contactPath = PUBLIC_CONTACT_PATH;
  readonly copy = this.legalLinks.chromeCopy;
}
