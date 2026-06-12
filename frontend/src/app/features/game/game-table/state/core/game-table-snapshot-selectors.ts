import { Injectable } from '@angular/core';
import { GameCardInstance, GameSnapshot, GameZoneName } from '../../../../../core/models/game.model';
import type { CardImageUris } from '../../../../../core/models/card.model';
import { gameBackgroundImageUrl, gameSleevesImageUrl } from '../../utils/game-table-visual-assets';
import { BattlefieldCardSize, BattlefieldSize, renderedBattlefieldPosition } from '../../utils/battlefield-position';

export interface PlayerView {
  id: string;
  state: GameSnapshot['players'][string];
}

@Injectable()
export class GameTableSnapshotSelectors {
  players(snapshot: GameSnapshot | null): PlayerView[] {
    const players = snapshot?.players ?? {};

    return Object.entries(players).map(([id, state]) => ({ id, state }));
  }

  focusedPlayer(snapshot: GameSnapshot | null, players: PlayerView[], focusedPlayerId: string | null): PlayerView | null {
    const focusedId = focusedPlayerId ?? snapshot?.turn.activePlayerId ?? players[0]?.id ?? null;

    return players.find((player) => player.id === focusedId) ?? players[0] ?? null;
  }

  currentPlayer(players: PlayerView[], userId: string | null | undefined): PlayerView | null {
    return players.find((player) => player.state.user.id === userId) ?? null;
  }

  isGameOwner(snapshot: GameSnapshot | null, currentPlayer: PlayerView | null): boolean {
    return snapshot?.ownerId === currentPlayer?.id;
  }

  zoneTitle(zone: GameZoneName): string {
    const titles: Record<GameZoneName, string> = {
      library: 'Library',
      hand: 'Hand',
      battlefield: 'Battlefield',
      graveyard: 'Graveyard',
      exile: 'Exile',
      command: 'Command',
    };

    return titles[zone];
  }

  zoneHint(zone: GameZoneName): string {
    const hints: Record<GameZoneName, string> = {
      library: 'Draw, reveal, shuffle',
      hand: 'Private cards',
      battlefield: 'Play area',
      graveyard: 'Public discard',
      exile: 'Public exile',
      command: 'Command zone',
    };

    return hints[zone];
  }

  zoneCount(player: PlayerView, zone: GameZoneName): number {
    return player.state.zoneCounts?.[zone] ?? player.state.zones[zone]?.length ?? 0;
  }

  commandZoneCards(player: PlayerView): readonly GameCardInstance[] {
    return player.state.zones.command ?? [];
  }

  commanderCards(player: PlayerView): readonly GameCardInstance[] {
    const commanders = Object.values(player.state.zones)
      .flat()
      .filter((card) => card.isCommander === true);
    const seen = new Set<string>();

    return commanders.filter((card) => {
      if (seen.has(card.instanceId)) {
        return false;
      }

      seen.add(card.instanceId);
      return true;
    });
  }

  primaryCommander(player: PlayerView): GameCardInstance | null {
    return this.commandZoneCards(player)[0] ?? this.commanderCards(player)[0] ?? null;
  }

  commanderCastCount(snapshot: GameSnapshot | null, player: PlayerView, commander?: GameCardInstance | null): number {
    const resolvedCommander = commander ?? this.primaryCommander(player);
    if (!resolvedCommander) {
      return 0;
    }

    const scopedValue = snapshot?.counters?.[`commander:${resolvedCommander.instanceId}`]?.['casts'];
    if (scopedValue !== undefined) {
      return Math.max(0, Number(scopedValue));
    }

    const legacyPrimaryCommander = this.primaryCommander(player);
    if (legacyPrimaryCommander?.instanceId === resolvedCommander.instanceId) {
      return Math.max(0, Number(snapshot?.counters?.[`commander:${player.id}`]?.['casts'] ?? 0));
    }

    return 0;
  }

  countItems(count: number): number[] {
    return Array.from({ length: Math.min(count, 12) }, (_, index) => index);
  }

  cardImage(card: GameCardInstance, snapshot: GameSnapshot | null): string | null {
    if (this.shouldShowCardBack(card)) {
      return this.cardBackImage(this.cardOwnerSleevesName(card, snapshot));
    }

    return this.visibleCardImage(card);
  }

  publicCardImage(card: GameCardInstance): string | null {
    return this.visibleCardImage(card);
  }

  cardBackImage(sleevesName?: string | null): string {
    return gameSleevesImageUrl(sleevesName);
  }

  gameBackgroundImage(player: PlayerView | null): string {
    return gameBackgroundImageUrl(player?.state.backgroundName);
  }

  shouldShowCardBack(card: GameCardInstance): boolean {
    return Boolean(card.faceDown || card.hidden);
  }

  deckLabel(player: PlayerView | null): string {
    const deckName = player?.state.deckName?.trim();

    return deckName && deckName.length > 0 ? deckName : '';
  }

  firstCounter(card: GameCardInstance): { key: string; value: number } | null {
    const entries = Object.entries(card.counters ?? {}).filter(([, value]) => Number.isFinite(Number(value)) && Number(value) >= 0);

    return entries.length > 0 ? { key: entries[0][0], value: Number(entries[0][1]) } : null;
  }

  hasPowerToughness(card: GameCardInstance): boolean {
    return card.power !== null && card.power !== undefined && card.toughness !== null && card.toughness !== undefined;
  }

  shouldShowPowerToughness(card: GameCardInstance): boolean {
    return this.hasPowerToughness(card);
  }

  cardPowerValue(card: GameCardInstance): number | null {
    return card.power ?? null;
  }

  cardToughnessValue(card: GameCardInstance): number | null {
    return card.toughness ?? null;
  }

  cardPosition(
    card: GameCardInstance,
    battlefieldSize?: BattlefieldSize,
    cardSize?: BattlefieldCardSize,
  ): { x: number; y: number } | null {
    return renderedBattlefieldPosition(card.position, battlefieldSize, cardSize);
  }

  topVisibleCard(player: PlayerView, zone: GameZoneName): GameCardInstance | null {
    if (zone === 'hand') {
      return null;
    }

    const cards = player.state.zones[zone] ?? [];
    if (zone === 'library') {
      const topCard = cards[0] ?? null;

      return topCard && this.isLibraryTopCardVisible(player, topCard) ? topCard : null;
    }

    return cards.at(-1) ?? null;
  }

  zonePreviewCard(player: PlayerView, zone: GameZoneName): GameCardInstance | null {
    return this.topVisibleCard(player, zone);
  }

  zonePreviewImage(player: PlayerView, zone: GameZoneName): string | null {
    if (zone === 'library') {
      const topCard = this.zonePreviewCard(player, zone);
      if (topCard && !topCard.hidden) {
        return this.publicCardImage(topCard);
      }

      return this.zoneCount(player, zone) > 0 ? this.cardBackImage(player.state.sleevesName) : null;
    }

    const card = this.zonePreviewCard(player, zone);

    return card ? this.publicCardImage(card) : null;
  }

  zoneStackLayerImage(player: PlayerView, zone: GameZoneName): string | null {
    if (zone === 'hand' || zone === 'battlefield' || zone === 'command') {
      return null;
    }

    const cards = player.state.zones[zone] ?? [];
    const secondCard = zone === 'library' ? cards[1] ?? null : cards.at(-2) ?? null;
    if (!secondCard) {
      return null;
    }

    if (zone === 'library') {
      return !secondCard.hidden && (secondCard.revealedTo?.length ?? 0) > 0
        ? this.publicCardImage(secondCard)
        : this.cardBackImage(player.state.sleevesName);
    }

    return this.publicCardImage(secondCard);
  }

  topDraggableCard(player: PlayerView, zone: GameZoneName, canControlPlayer: boolean): GameCardInstance | null {
    if (!canControlPlayer || zone === 'hand' || zone === 'battlefield') {
      return null;
    }

    if (zone === 'library') {
      return player.state.zones.library?.[0] ?? null;
    }

    return player.state.zones[zone]?.at(-1) ?? null;
  }

  private cardOwnerSleevesName(card: GameCardInstance, snapshot: GameSnapshot | null): string | null {
    const ownerId = card.ownerId ?? card.controllerId;

    return ownerId ? snapshot?.players[ownerId]?.sleevesName ?? null : null;
  }

  private visibleCardImage(card: GameCardInstance): string | null {
    const activeFace = this.activeFaceImageUris(card);

    return this.bestImageUri(activeFace) ?? this.bestImageUri(card.imageUris) ?? this.bestImageUri(card.cardFaces?.[0]?.imageUris);
  }

  private isLibraryTopCardVisible(player: PlayerView, card: GameCardInstance): boolean {
    return player.state.playTopLibraryRevealed === true || (card.revealedTo?.length ?? 0) > 0;
  }

  private activeFaceImageUris(card: GameCardInstance): CardImageUris | null {
    const faces = card.cardFaces ?? [];
    if (faces.length < 2) {
      return null;
    }

    const index = Number.isInteger(card.activeFaceIndex) ? Number(card.activeFaceIndex) : 0;

    return faces[Math.max(0, Math.min(faces.length - 1, index))]?.imageUris ?? null;
  }

  private bestImageUri(imageUris: CardImageUris | Record<string, string> | null | undefined): string | null {
    return imageUris?.['normal'] ?? imageUris?.['large'] ?? imageUris?.['small'] ?? imageUris?.['png'] ?? null;
  }

  colorIdentity(player: PlayerView | null): string[] {
    return player?.state.colorIdentity?.length ? player.state.colorIdentity : ['W'];
  }

  colorAccent(player: PlayerView | null): string {
    const colorMap: Record<string, string> = {
      W: '#f8f3df',
      U: '#7cc7ff',
      B: '#b9a8c9',
      R: '#f08264',
      G: '#76c779',
    };

    return colorMap[this.colorIdentity(player)[0] ?? 'W'] ?? '#f8f3df';
  }

  manaSymbols(player: PlayerView | null): string[] {
    return this.colorIdentity(player);
  }

  logTime(createdAt: string): string {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(date);
  }

  isPhasePast(phases: string[], snapshot: GameSnapshot | null, phase: string): boolean {
    const activePhase = snapshot?.turn.phase;
    const activeIndex = activePhase ? phases.indexOf(activePhase) : -1;
    const phaseIndex = phases.indexOf(phase);

    return activeIndex > -1 && phaseIndex > -1 && phaseIndex < activeIndex;
  }
}
