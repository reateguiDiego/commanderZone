import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CardsApi } from '../../../core/api/cards.api';
import { Card } from '../../../core/models/card.model';
import { bestCardImage } from '../../../shared/utils/card-image';

@Injectable()
export class DeckCardImageCache {
  private readonly cardsApi = inject(CardsApi);
  private readonly imageUrlsState = signal<Record<string, string | null>>({});
  private readonly requests = new Map<string, Promise<string | null>>();
  private cacheVersion = 0;

  readonly imageUrls = computed(() => this.imageUrlsState());

  imageUrl(card: Card): string | null {
    const imageUrls = this.imageUrlsState();
    if (Object.prototype.hasOwnProperty.call(imageUrls, card.scryfallId)) {
      return imageUrls[card.scryfallId];
    }

    return bestCardImage(card);
  }

  load(card: Card): void {
    void this.resolve(card);
  }

  async resolve(card: Card): Promise<string | null> {
    const imageUrls = this.imageUrlsState();
    if (Object.prototype.hasOwnProperty.call(imageUrls, card.scryfallId)) {
      return imageUrls[card.scryfallId];
    }

    const existingRequest = this.requests.get(card.scryfallId);
    if (existingRequest) {
      return existingRequest;
    }

    const requestVersion = this.cacheVersion;
    const request = this.fetchImage(card);
    this.requests.set(card.scryfallId, request);

    const imageUrl = await request;
    this.requests.delete(card.scryfallId);
    if (requestVersion === this.cacheVersion) {
      this.imageUrlsState.update((current) => ({ ...current, [card.scryfallId]: imageUrl }));
    }

    return imageUrl;
  }

  clear(): void {
    this.cacheVersion += 1;
    this.requests.clear();
    this.imageUrlsState.set({});
  }

  private async fetchImage(card: Card): Promise<string | null> {
    try {
      const response = await firstValueFrom(this.cardsApi.image(card.scryfallId, 'normal'));
      return response.uri;
    } catch {
      return bestCardImage(card);
    }
  }
}
