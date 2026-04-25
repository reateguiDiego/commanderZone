import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { CardsApi } from '../../core/api/cards.api';
import { Card } from '../../core/models/card.model';
import { bestCardImage } from '../../shared/utils/card-image';

@Component({
  selector: 'app-card-detail',
  imports: [RouterLink, LucideAngularModule],
  template: `
    <section class="page-stack">
      <a class="text-button" routerLink="/cards">
        <lucide-icon name="arrow-left" size="16" />
        Back to search
      </a>

      @if (loading()) {
        <p class="notice">Loading card...</p>
      } @else if (error()) {
        <p class="notice error">{{ error() }}</p>
      } @else if (card(); as card) {
        <article class="detail-layout">
          <div class="detail-image">
            @if (image(card); as imageUrl) {
              <img [src]="imageUrl" [alt]="card.name" />
            } @else {
              <div class="card-fallback tall">{{ card.name }}</div>
            }
          </div>
          <div class="detail-panel">
            <span class="eyebrow">{{ card.set || 'MTG' }} #{{ card.collectorNumber || '-' }}</span>
            <h2>{{ card.name }}</h2>
            <p class="mana-line">{{ card.manaCost || 'No mana cost' }}</p>
            <p>{{ card.typeLine }}</p>
            <p class="oracle">{{ card.oracleText || 'No oracle text available.' }}</p>
            <p>
              Commander:
              <strong [class.ok]="card.commanderLegal" [class.bad]="!card.commanderLegal">
                {{ card.commanderLegal ? 'Legal' : 'Not legal' }}
              </strong>
            </p>
          </div>
        </article>
      }
    </section>
  `,
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
