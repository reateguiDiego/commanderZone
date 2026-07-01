import { Injectable, inject } from '@angular/core';
import { environment } from '../../../../../environments/environment';
import type { BootstrapStaticCardV2 } from '../../../../core/models/game-v2.model';
import { GameTableNormalizedV2Store } from '../state/realtime/game-table-normalized-v2.store';

interface CommanderZoneE2eStaticCardCacheTools {
  dropTopLibraryStaticCards(playerId: string): number;
}

declare global {
  interface Window {
    commanderZoneE2eStaticCardCache?: CommanderZoneE2eStaticCardCacheTools;
  }
}

@Injectable()
export class GameTableE2eStaticCardCacheToolsService {
  private readonly normalizedV2Store = inject(GameTableNormalizedV2Store);
  private readonly tools: CommanderZoneE2eStaticCardCacheTools = {
    dropTopLibraryStaticCards: (playerId) => this.dropTopLibraryStaticCards(playerId),
  };

  install(): void {
    if (environment.production || typeof window === 'undefined') {
      return;
    }

    try {
      if (window.localStorage?.getItem('commanderzone.e2eStaticCardCacheTools') !== '1') {
        return;
      }
    } catch {
      return;
    }

    window.commanderZoneE2eStaticCardCache = this.tools;
  }

  destroy(): void {
    if (typeof window === 'undefined') {
      return;
    }

    if (window.commanderZoneE2eStaticCardCache === this.tools) {
      delete window.commanderZoneE2eStaticCardCache;
    }
  }

  private dropTopLibraryStaticCards(playerId: string): number {
    const state = this.normalizedV2Store.state();
    const topLibraryInstanceId = state?.zones[playerId]?.library[0] ?? null;
    if (!state || !topLibraryInstanceId) {
      return 0;
    }

    const instance = state.instances[topLibraryInstanceId];
    if (!instance) {
      return 0;
    }

    const targetAliases = new Set([
      ...staticCardE2eLookupAliases(instance.cardRef),
      ...staticCardE2eLookupAliases(instance.cardKey),
      ...staticCardE2eLookupAliases(instance.printId),
    ]);
    if (targetAliases.size === 0) {
      return 0;
    }

    const preservedInstanceIds = Object.keys(state.instances);
    const nextInstances = { ...state.instances };
    const nextStaticCards = { ...state.staticCards };
    let removed = 0;
    for (const [key, card] of Object.entries(state.staticCards)) {
      const candidateAliases = new Set([
        ...staticCardE2eLookupAliases(key),
        ...staticCardE2eLookupAliases(card.cardRef),
        ...staticCardE2eLookupAliases(card.cardKey),
        ...staticCardE2eLookupAliases(card.printId),
        ...staticCardE2eLookupAliases(card.scryfallId),
      ]);
      const shouldRemove = [...targetAliases].some((alias) => candidateAliases.has(alias));
      if (!shouldRemove) {
        continue;
      }

      removed += 1;
      delete nextStaticCards[key];
    }

    if (removed === 0) {
      return 0;
    }

    for (const instanceId of preservedInstanceIds) {
      const visibleInstance = nextInstances[instanceId];
      if (!visibleInstance) {
        continue;
      }

      const visibleStaticCard = state.staticCards[visibleInstance.cardRef];
      if (!visibleStaticCard) {
        continue;
      }

      const candidateAliases = new Set([
        ...staticCardE2eLookupAliases(visibleInstance.cardRef),
        ...staticCardE2eLookupAliases(visibleInstance.cardKey),
        ...staticCardE2eLookupAliases(visibleInstance.printId),
        ...staticCardE2eLookupAliases(visibleStaticCard.cardRef),
        ...staticCardE2eLookupAliases(visibleStaticCard.cardKey),
        ...staticCardE2eLookupAliases(visibleStaticCard.printId),
        ...staticCardE2eLookupAliases(visibleStaticCard.scryfallId),
      ]);
      const needsVisibleClone = [...targetAliases].some((alias) => candidateAliases.has(alias));
      if (!needsVisibleClone) {
        continue;
      }

      const cloneRef = `e2e-static:${instanceId}`;
      const cloneKey = `${cloneRef}:key`;
      const clonePrintId = `${cloneRef}:print`;
      const clonedStaticCard: BootstrapStaticCardV2 = {
        ...visibleStaticCard,
        cardRef: cloneRef,
        cardKey: cloneKey,
        printId: clonePrintId,
        scryfallId: null,
      };
      nextStaticCards[cloneRef] = clonedStaticCard;
      nextInstances[instanceId] = {
        ...visibleInstance,
        cardRef: cloneRef,
        cardKey: cloneKey,
        printId: clonePrintId,
        cardVersion: clonedStaticCard.cardVersion,
        language: clonedStaticCard.language,
        viewerVisibility: clonedStaticCard.viewerVisibility,
      };
    }

    this.normalizedV2Store.state.set({
      ...state,
      instances: nextInstances,
      staticCards: nextStaticCards,
    });

    return removed;
  }
}

function staticCardE2eLookupAliases(key: string | null | undefined): string[] {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) {
    return [];
  }

  const aliases = new Set<string>([trimmed]);
  const runtimeScryfallId = staticCardE2eScryfallIdFromRuntimeCardKey(trimmed);
  if (runtimeScryfallId) {
    aliases.add(runtimeScryfallId);
    aliases.add(`${runtimeScryfallId}:card`);
    aliases.add(`${runtimeScryfallId}:token`);
  }

  const suffixedScryfallId = staticCardE2eScryfallIdFromStaticRef(trimmed);
  if (suffixedScryfallId) {
    aliases.add(suffixedScryfallId);
  }

  return [...aliases];
}

function staticCardE2eScryfallIdFromRuntimeCardKey(key: string): string | null {
  const parts = key.split(':');
  if (parts.length < 3 || parts[0] !== 'scryfall') {
    return null;
  }

  const scryfallId = parts[1]?.trim() ?? '';
  return scryfallId === '' ? null : scryfallId;
}

function staticCardE2eScryfallIdFromStaticRef(key: string): string | null {
  const match = /^(.+):(card|token)$/.exec(key);
  const scryfallId = match?.[1]?.trim() ?? '';

  return scryfallId === '' ? null : scryfallId;
}
