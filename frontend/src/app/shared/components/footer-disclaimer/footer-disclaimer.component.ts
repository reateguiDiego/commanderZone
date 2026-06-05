import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { LegalLinksService } from '../../../core/legal/legal-links.service';

@Component({
  selector: 'app-footer-disclaimer',
  templateUrl: './footer-disclaimer.component.html',
  styleUrl: './footer-disclaimer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FooterDisclaimerComponent {
  private readonly legalLinks = inject(LegalLinksService);

  readonly copy = this.legalLinks.chromeCopy;
  readonly links = computed(() => this.copy().footer.links);
}
