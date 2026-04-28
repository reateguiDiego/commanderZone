import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { Card } from '../../../core/models/card.model';
import { ManaSymbolsComponent } from '../../../shared/mana/mana-symbols/mana-symbols.component';
import { ManaTextComponent } from '../../../shared/mana/mana-text/mana-text.component';
import { bestCardImage } from '../../../shared/utils/card-image';

@Component({
  selector: 'app-card-detail',
  imports: [RouterLink, LucideAngularModule, ManaSymbolsComponent, ManaTextComponent],
  templateUrl: './card-detail.component.html',
  styleUrl: './card-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardDetailComponent {
  private readonly cardsApi = inject(CardsApi);
  private readonly route = inject(ActivatedRoute);

  readonly card = signal<Card | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  image(card: Card): string | null {
    return bestCardImage(card);
  }

  private async load(): Promise<void> {
    const scryfallId = this.route.snapshot.paramMap.get('scryfallId');
    if (!scryfallId) {
      this.error.set('Missing card id.');
      this.loading.set(false);
      return;
    }

    try {
      const response = await firstValueFrom(this.cardsApi.get(scryfallId));
      this.card.set(response.card);
    } catch {
      this.error.set('Could not load card.');
    } finally {
      this.loading.set(false);
    }
  }
}
