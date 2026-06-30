import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PUBLIC_CONTACT_PATH } from '../../../core/contact/contact.config';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';

@Component({
  selector: 'app-noindex-footer-disclaimer',
  imports: [RouterLink, RuntimeTranslatePipe],
  templateUrl: './noindex-footer-disclaimer.component.html',
  styleUrl: './noindex-footer-disclaimer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoindexFooterDisclaimerComponent {
  readonly currentYear = new Date().getFullYear();
  readonly contactPath = PUBLIC_CONTACT_PATH;
}
