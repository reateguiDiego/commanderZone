import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-footer-disclaimer',
  imports: [RuntimeTranslatePipe],
  templateUrl: './footer-disclaimer.component.html',
  styleUrl: './footer-disclaimer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FooterDisclaimerComponent {}
