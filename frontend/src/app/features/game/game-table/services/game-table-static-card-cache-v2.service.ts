import { Injectable } from '@angular/core';
import type { BootstrapStaticCardV2, BootstrapV2 } from '../../../../core/models/game-v2.model';

@Injectable({ providedIn: 'root' })
export class GameTableStaticCardCacheV2Service {
  private readonly staticCardsByCatalogKey = new Map<string, BootstrapStaticCardV2>();

  knownCatalogKeys(): string[] {
    return [...this.staticCardsByCatalogKey.keys()];
  }

  mergeBootstrap(bootstrap: BootstrapV2): BootstrapV2 {
    for (const card of Object.values(bootstrap.staticCards)) {
      this.staticCardsByCatalogKey.set(this.catalogKey(card), { ...card });
    }

    const staticCards = { ...bootstrap.staticCards };
    for (const instance of Object.values(bootstrap.instances)) {
      if (staticCards[instance.cardRef]) {
        continue;
      }

      const cardKey = instance.cardKey?.trim();
      const cardVersion = instance.cardVersion?.trim();
      const catalogKey = this.catalogKey(instance);
      if (!cardKey || !cardVersion || !catalogKey) {
        continue;
      }

      const cached = this.staticCardsByCatalogKey.get(catalogKey);
      if (cached) {
        staticCards[instance.cardRef] = { ...cached, cardRef: instance.cardRef };
      }
    }

    return {
      ...bootstrap,
      staticCards,
    };
  }

  clear(): void {
    this.staticCardsByCatalogKey.clear();
  }

  private catalogKey(card: {
    cardRef?: string;
    cardKey?: string;
    printId?: string | null;
    scryfallId?: string | null;
    cardVersion?: string;
    language?: string | null;
    viewerVisibility?: string | null;
  }): string {
    const cardKey = card.cardKey?.trim() || card.cardRef?.trim() || '';
    const printId = card.printId?.trim() || card.scryfallId?.trim() || '';
    const cardVersion = card.cardVersion?.trim() || '';
    const language = card.language?.trim() || '';
    const viewerVisibility = card.viewerVisibility?.trim() || '';

    if (!cardKey || !printId || !cardVersion || !language || !viewerVisibility) {
      return '';
    }

    return [cardKey, printId, cardVersion, language, viewerVisibility]
      .map((part) => encodeURIComponent(part))
      .join('|');
  }
}
