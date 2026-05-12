import { Injectable } from '@angular/core';
import { GameCardInstance, GameSnapshot, GameZoneName } from '../../../../core/models/game.model';
import { gameBackgroundImageUrl, gameSleevesImageUrl } from '../game-table-visual-assets';

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

  commanderCastCount(snapshot: GameSnapshot | null, player: PlayerView): number {
    return Math.max(0, Number(snapshot?.counters?.[`commander:${player.id}`]?.['casts'] ?? 0));
  }

  countItems(count: number): number[] {
    return Array.from({ length: Math.min(count, 12) }, (_, index) => index);
  }

  cardImage(card: GameCardInstance, snapshot: GameSnapshot | null): string | null {
    if (this.shouldShowCardBack(card)) {
      return this.cardBackImage(this.cardOwnerSleevesName(card, snapshot));
    }

    return card.imageUris?.['normal'] ?? card.imageUris?.['small'] ?? null;
  }

  publicCardImage(card: GameCardInstance): string | null {
    return card.imageUris?.['normal'] ?? card.imageUris?.['small'] ?? null;
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
    const commander = player?.state.zones.command?.[0]?.name;

    return commander ? `${commander} deck` : 'Commander deck';
  }

  firstCounter(card: GameCardInstance): { key: string; value: number } | null {
    const entries = Object.entries(card.counters ?? {}).filter(([, value]) => value > 0);

    return entries.length > 0 ? { key: entries[0][0], value: entries[0][1] } : null;
  }

  hasPowerToughness(card: GameCardInstance): boolean {
    return card.power !== null && card.power !== undefined && card.toughness !== null && card.toughness !== undefined;
  }

  shouldShowPowerToughness(card: GameCardInstance): boolean {
    return this.hasPowerToughness(card) || /\bcreature\b/i.test(card.typeLine ?? '');
  }

  cardPowerValue(card: GameCardInstance): number {
    return card.power ?? 0;
  }

  cardToughnessValue(card: GameCardInstance): number {
    return card.toughness ?? 0;
  }

  cardPosition(card: GameCardInstance): { x: number; y: number } | null {
    const position = card.position;
    if (!position || (position.x <= 0 && position.y <= 0)) {
      return null;
    }

    return position;
  }

  topVisibleCard(player: PlayerView, zone: GameZoneName): GameCardInstance | null {
    if (zone === 'library' || zone === 'hand') {
      return null;
    }

    const cards = player.state.zones[zone] ?? [];

    return cards.at(-1) ?? null;
  }

  zonePreviewCard(player: PlayerView, zone: GameZoneName): GameCardInstance | null {
    return this.topVisibleCard(player, zone);
  }

  zonePreviewImage(player: PlayerView, zone: GameZoneName): string | null {
    if (zone === 'library') {
      return this.zoneCount(player, zone) > 0 ? this.cardBackImage(player.state.sleevesName) : null;
    }

    const card = this.zonePreviewCard(player, zone);

    return card ? this.publicCardImage(card) : null;
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

  miniCardLeft(card: GameCardInstance, index: number): number {
    const position = this.cardPosition(card);
    if (position) {
      return Math.max(1, Math.min(90, (position.x / 900) * 100));
    }

    return 2 + (index % 10) * 9.4;
  }

  miniCardTop(card: GameCardInstance, index: number): number {
    const position = this.cardPosition(card);
    if (position) {
      return Math.max(4, Math.min(78, (position.y / 520) * 100));
    }

    return 6 + Math.floor(index / 10) * 24;
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
