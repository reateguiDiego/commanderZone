import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { Card } from '../../../core/models/card.model';
import { ManaTextComponent } from '../../mana/mana-text/mana-text.component';
import { AppModalComponent } from '../../ui/app-modal/app-modal.component';
import { GlobalLoaderComponent } from '../../ui/global-loader/global-loader.component';
import { CardFaceImageComponent } from '../card-face-image/card-face-image.component';
import { CardFaceToggleButtonComponent } from '../card-face-toggle-button/card-face-toggle-button.component';
import { cardLegalityPills, cardRulesText, isBattleCard } from '../../utils/card-details';
import { hasAlternateCardFace } from '../../utils/card-faces';

@Component({
  selector: 'app-card-details-modal',
  imports: [
    AppModalComponent,
    CardFaceImageComponent,
    CardFaceToggleButtonComponent,
    GlobalLoaderComponent,
    ManaTextComponent,
    RuntimeTranslatePipe,
  ],
  templateUrl: './card-details-modal.component.html',
  styleUrl: './card-details-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardDetailsModalComponent {
  readonly open = input(false);
  readonly card = input<Card | null>(null);
  readonly cardName = input('');
  readonly loading = input(false);
  readonly errorKey = input<string | null>(null);
  readonly closeRequested = output<void>();
  readonly rulesText = computed(() => cardRulesText(this.card()));
  readonly legalFormatPills = computed(() => cardLegalityPills(this.card(), true));
  readonly illegalFormatPills = computed(() => cardLegalityPills(this.card(), false));
  readonly hasAlternateFace = computed(() => hasAlternateCardFace(this.card()));

  isBattle(card: Card): boolean {
    return isBattleCard(card);
  }
}
