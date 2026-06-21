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
      if (!cardKey || !cardVersion) {
        continue;
      }

      const cached = this.staticCardsByCatalogKey.get(`${cardKey}@${cardVersion}`);
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

  private catalogKey(card: BootstrapStaticCardV2): string {
    return `${card.cardKey ?? card.cardRef}@${card.cardVersion ?? 'legacy-snapshot-v1'}`;
  }
}
