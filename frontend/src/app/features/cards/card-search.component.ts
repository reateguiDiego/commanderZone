import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { CardsApi } from '../../core/api/cards.api';
import { Card } from '../../core/models/card.model';
import { bestCardImage } from '../../shared/utils/card-image';

@Component({
  selector: 'app-card-search',
  imports: [FormsModule, RouterLink, LucideAngularModule],
  template: `
    <section class="page-stack">
      <div class="tool-header">
        <div>
          <span class="eyebrow">Cards</span>
          <h2>Search library</h2>
        </div>
        <form class="search-bar" (ngSubmit)="search()">
          <lucide-icon name="search" size="18" />
          <input name="query" placeholder="Sol Ring, Atraxa, Lightning Greaves..." [(ngModel)]="query" />
          <button class="primary-button compact" type="submit">Search</button>
        </form>
      </div>

      @if (loading()) {
        <p class="notice">Searching cards...</p>
      } @else if (error()) {
        <p class="notice error">{{ error() }}</p>
      } @else if (searched() && results().length === 0) {
        <p class="notice">No cards found.</p>
      }

      <div class="card-results">
        @for (card of results(); track card.scryfallId) {
          <a class="mtg-card-result" [routerLink]="['/cards', card.scryfallId]">
            @if (image(card); as imageUrl) {
              <img [src]="imageUrl" [alt]="card.name" loading="lazy" />
            } @else {
              <div class="card-fallback">{{ card.name }}</div>
            }
            <span>
              <strong>{{ card.name }}</strong>
              <small>{{ card.manaCost || 'No cost' }}</small>
              <small>{{ card.typeLine || 'Unknown type' }}</small>
            </span>
          </a>
        }
      </div>
    </section>
  `,
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
