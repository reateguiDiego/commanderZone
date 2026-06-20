import { RuntimeTranslatePipe } from '../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { Card } from '../../../core/models/card.model';
import { ManaSymbolsComponent } from '../../../shared/mana/mana-symbols/mana-symbols.component';
import { bestCardImage } from '../../../shared/utils/card-image';
import { CzButtonDirective } from '../../../shared/ui/button/button.directive';

@Component({
  selector: 'app-card-search',
  imports: [
    RuntimeTranslatePipe,
    FormsModule,
    RouterLink,
    LucideAngularModule,
    ManaSymbolsComponent,
    CzButtonDirective,
  ],
  templateUrl: './card-search.component.html',
  styleUrl: './card-search.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardSearchComponent {
  private readonly cardsApi = inject(CardsApi);

  readonly results = signal<Card[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly searched = signal(false);
  query = '';

  image(card: Card): string | null {
    return bestCardImage(card);
  }

  async search(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.searched.set(true);

    try {
      const response = await firstValueFrom(this.cardsApi.search(this.query.trim()));
      this.results.set(response.data);
    } catch {
      this.error.set('Could not search cards.');
    } finally {
      this.loading.set(false);
    }
  }
}
