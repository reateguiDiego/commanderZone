import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { Card } from '../../../core/models/card.model';
import { AppModalComponent } from '../../ui/app-modal/app-modal.component';
import { GlobalLoaderComponent } from '../../ui/global-loader/global-loader.component';
import { CardFaceImageComponent } from '../card-face-image/card-face-image.component';
import { isBattleCard } from '../../utils/card-details';

@Component({
  selector: 'app-card-printings-modal',
  imports: [
    AppModalComponent,
    CardFaceImageComponent,
    GlobalLoaderComponent,
    RuntimeTranslatePipe,
  ],
  templateUrl: './card-printings-modal.component.html',
  styleUrl: './card-printings-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardPrintingsModalComponent {
  readonly open = input(false);
  readonly cardName = input('');
  readonly printings = input<readonly Card[]>([]);
  readonly loading = input(false);
  readonly errorKey = input<string | null>(null);
  readonly closeRequested = output<void>();

  isBattle(card: Card): boolean {
    return isBattleCard(card);
  }
}
