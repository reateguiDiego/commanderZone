import { Injectable, signal } from '@angular/core';
import { GameCardInstance, GameSnapshot, GameZoneName } from '../../../../../core/models/game.model';

type GameLogEntry = GameSnapshot['eventLog'][number];

interface CommanderCastCounterChange {
  from: number;
  to: number;
}

type CommanderCastCounterLog = CommanderCastCounterChange | { to: number };

interface CommanderDamageChange {
  sourceName: string;
  targetName: string;
  from: number;
  to: number;
}

interface PlayerCounterChange {
  playerName: string;
  counterName: string;
  from: number;
  to: number;
}

export interface GameLogEntryView extends GameLogEntry {
  card: GameCardInstance | null;
  cardList: readonly string[];
  cardListPrefix: string;
  cardListSuffix: string;
  cardListLabel: string;
  messagePrefix: string;
  messageSuffix: string;
  appearance: 'default' | 'phase' | 'death';
}

@Injectable()
export class GameTableChatLogState {
  readonly chatMessage = signal('');
  readonly chatTargetPlayerId = signal<string | null>(null);

  normalizedMessage(): string {
    return this.chatMessage().trim();
  }

  setMessage(value: string): void {
    this.chatMessage.set(value);
  }

  clearMessage(): void {
    this.chatMessage.set('');
  }

  setTargetPlayerId(playerId: string | null): void {
    this.chatTargetPlayerId.set(playerId && playerId !== 'all' ? playerId : null);
  }

  eventLog(snapshot: GameSnapshot | null): GameLogEntry[] {
    return this.compactLog(this.suppressDefeatedPlayerLogs(
      [...(snapshot?.eventLog ?? [])].filter((entry) =>
        entry.type !== 'card.position.changed'
        && entry.type !== 'cards.position.changed'
        && entry.message !== 'Reordered hand.'),
    ));
  }

  eventLogView(snapshot: GameSnapshot | null, zones: readonly GameZoneName[]): GameLogEntryView[] {
    return this.eventLog(snapshot).map((entry) => this.toLogEntryView(snapshot, zones, entry));
  }

  private toLogEntryView(snapshot: GameSnapshot | null, zones: readonly GameZoneName[], entry: GameLogEntry): GameLogEntryView {
    if (this.isPrivateLibraryDestinationLog(entry)) {
      return {
        ...entry,
        card: null,
        cardList: [],
        cardListPrefix: '',
        cardListSuffix: '',
        cardListLabel: '',
        messagePrefix: this.privateLibraryDestinationMessage(entry.message),
        messageSuffix: '',
        appearance: this.logAppearance(entry),
      };
    }

    const cardListView = this.cardListView(entry);
    if (cardListView) {
      return {
        ...entry,
        card: null,
        cardList: cardListView.cardList,
        cardListPrefix: cardListView.messagePrefix,
        cardListSuffix: cardListView.messageSuffix,
        cardListLabel: cardListView.label,
        messagePrefix: entry.message,
        messageSuffix: '',
        appearance: this.logAppearance(entry),
      };
    }

    const card = this.cardFromLogEntry(snapshot, zones, entry);
    if (!card) {
      return {
        ...entry,
        card: null,
        cardList: [],
        cardListPrefix: '',
        cardListSuffix: '',
        cardListLabel: '',
        messagePrefix: entry.message,
        messageSuffix: '',
        appearance: this.logAppearance(entry),
      };
    }

    const index = entry.message.indexOf(card.name);

    return {
      ...entry,
      card,
      cardList: [],
      cardListPrefix: '',
      cardListSuffix: '',
      cardListLabel: '',
      messagePrefix: index >= 0 ? entry.message.slice(0, index) : entry.message,
      messageSuffix: index >= 0 ? entry.message.slice(index + card.name.length) : '',
      appearance: this.logAppearance(entry),
    };
  }

  private logAppearance(entry: GameLogEntry): GameLogEntryView['appearance'] {
    if (this.isDefeatLog(entry)) {
      return 'death';
    }

    return entry.type === 'turn.changed' ? 'phase' : 'default';
  }

  private isDefeatLog(entry: GameLogEntry): boolean {
    const message = entry.message.trim();

    return entry.type === 'player.defeated'
      || entry.type === 'game.concede'
      || /\bha muerto\.?$/i.test(message)
      || /\bconceded\.?$/i.test(message);
  }

  private suppressDefeatedPlayerLogs(entries: GameLogEntry[]): GameLogEntry[] {
    const defeatedPlayerIds = new Set<string>();
    const visibleEntries: GameLogEntry[] = [];

    for (const entry of entries) {
      const actorId = entry.actorId ?? null;
      if (actorId && defeatedPlayerIds.has(actorId)) {
        continue;
      }

      visibleEntries.push(entry);
      if (this.isDefeatLog(entry) && actorId) {
        defeatedPlayerIds.add(actorId);
      }
    }

    return visibleEntries;
  }

  private cardFromLogEntry(snapshot: GameSnapshot | null, zones: readonly GameZoneName[], entry: GameLogEntry): GameCardInstance | null {
    const explicitCard = this.explicitCardFromLogEntry(snapshot, entry);
    if (explicitCard) {
      return explicitCard;
    }

    if (!entry.message) {
      return null;
    }

    return this.allCards(snapshot, zones)
      .filter((card) => !card.hidden && card.name.length > 2 && entry.message.includes(card.name))
      .sort((left, right) => right.name.length - left.name.length)[0] ?? null;
  }

  private explicitCardFromLogEntry(snapshot: GameSnapshot | null, entry: GameLogEntry): GameCardInstance | null {
    if (!entry.cardInstanceId) {
      return null;
    }

    const playerIds = entry.cardPlayerId ? [entry.cardPlayerId] : Object.keys(snapshot?.players ?? {});
    for (const playerId of playerIds) {
      const player = snapshot?.players[playerId];
      if (!player) {
        continue;
      }

      const zones = entry.cardZone ? [entry.cardZone] : Object.keys(player.zones) as GameZoneName[];
      for (const zone of zones) {
        const card = player.zones[zone]?.find((candidate) => candidate.instanceId === entry.cardInstanceId && !candidate.hidden);
        if (card) {
          return card;
        }
      }
    }

    return null;
  }

  private cardListView(entry: GameLogEntry): {
    cardList: readonly string[];
    label: string;
    messagePrefix: string;
    messageSuffix: string;
  } | null {
    const cardList = entry.cardNames?.filter((name) => name.trim() !== '') ?? [];
    if (cardList.length < 2) {
      return null;
    }

    const labelMatch = /(\d+ (?:cards|cartas))/i.exec(entry.message);
    if (!labelMatch || labelMatch.index === undefined) {
      return null;
    }

    return {
      cardList,
      label: this.aggregateCardListLabel(labelMatch[1]),
      messagePrefix: entry.message.slice(0, labelMatch.index),
      messageSuffix: entry.message.slice(labelMatch.index + labelMatch[1].length),
    };
  }

  private aggregateCardListLabel(label: string): string {
    const countMatch = /^(\d+)\s+(?:cards|cartas)$/i.exec(label.trim());

    return countMatch ? `${countMatch[1]} cartas` : label;
  }

  private isPrivateLibraryDestinationLog(entry: GameLogEntry): boolean {
    if (
      (entry.type !== 'card.moved' && entry.type !== 'cards.moved')
      || !/\bto (?:top of |bottom of )?library\b/i.test(entry.message)
    ) {
      return false;
    }

    return /\bfrom hand to\b/i.test(entry.message)
      || !/\bfrom (?:battlefield|graveyard|exile|command) to\b/i.test(entry.message);
  }

  private privateLibraryDestinationMessage(message: string): string {
    if (/\bfrom hand to\b/i.test(message)) {
      return message;
    }

    if (/\bto bottom of library\b/i.test(message)) {
      return 'Moved a card to bottom of library.';
    }

    return message;
  }

  private allCards(snapshot: GameSnapshot | null, zones: readonly GameZoneName[]): GameCardInstance[] {
    return Object.values(snapshot?.players ?? {}).flatMap((player) => zones.flatMap((zone) => player.zones[zone] ?? []));
  }

  private compactLog(entries: GameLogEntry[]): GameLogEntry[] {
    return entries.reduce<GameLogEntry[]>((compact, entry) => {
      const previous = compact.at(-1);
      const merged = previous ? this.mergeEntries(previous, entry) : null;
      if (merged) {
        compact[compact.length - 1] = merged;
        const penultimate = compact.at(-2);
        const sequence = penultimate ? this.mergeCommanderMoveSequence(penultimate, merged) : null;
        if (sequence) {
          compact.splice(compact.length - 2, 2, sequence);
        }
      } else {
        compact.push(previous ? this.normalizeCommanderCastCounterEntry(previous, entry) : entry);
      }

      return compact;
    }, []);
  }

  private mergeEntries(previous: GameLogEntry, current: GameLogEntry): GameLogEntry | null {
    const commanderReturnCast = this.mergeCommanderReturnCast(previous, current);
    if (commanderReturnCast) {
      return commanderReturnCast;
    }

    const commanderCast = this.mergeCommanderCast(previous, current);
    if (commanderCast) {
      return commanderCast;
    }

    if (previous.actorId !== current.actorId || previous.type !== current.type) {
      return null;
    }

    return this.mergeDraw(previous, current)
      ?? this.mergeLife(previous, current)
      ?? this.mergeCommanderDamage(previous, current)
      ?? this.mergePlayerCounter(previous, current)
      ?? this.mergeCommanderCastCounter(previous, current)
      ?? this.mergeLoyalty(previous, current)
      ?? this.mergePowerToughness(previous, current)
      ?? this.mergeTapped(previous, current);
  }

  private mergeCommanderCast(previous: GameLogEntry, current: GameLogEntry): GameLogEntry | null {
    if (previous.actorId !== current.actorId || previous.type !== 'card.moved' || current.type !== 'counter.changed') {
      return null;
    }

    const movedMatch = /^Moved (.+) from command to battlefield\.$/.exec(previous.message);
    const counterChange = this.commanderCastCounterChange(current.message);
    if (!movedMatch || !counterChange || counterChange.to <= counterChange.from) {
      return null;
    }

    return {
      ...current,
      message: `${previous.message} ${this.commanderCastCounterMessage(counterChange.from, counterChange.to)}.`,
    };
  }

  private mergeCommanderMoveSequence(previous: GameLogEntry, current: GameLogEntry): GameLogEntry | null {
    if (previous.actorId !== current.actorId || previous.type !== 'card.moved') {
      return null;
    }

    const returnedMatch = /^Moved (.+) from battlefield to command\.$/.exec(previous.message);
    const castMatch = /^Moved (.+) from command to battlefield\. (Commander cast count (?:increased|decreased) from \d+ to \d+(?: \([+-]\d+(?: clicks)?\))?)\.$/.exec(current.message);
    const counterChange = castMatch ? this.commanderCastCounterChange(`${castMatch[2]}.`) : null;
    if (!returnedMatch || !castMatch || returnedMatch[1] !== castMatch[1] || !counterChange) {
      return null;
    }

    return {
      ...current,
      message: `${previous.message} ${this.commanderCastCounterMessage(counterChange.from, counterChange.to)}.`,
    };
  }

  private mergeCommanderReturnCast(previous: GameLogEntry, current: GameLogEntry): GameLogEntry | null {
    if (previous.actorId !== current.actorId || previous.type !== 'card.moved' || current.type !== 'counter.changed') {
      return null;
    }

    const movedMatch = /^Moved (.+) from battlefield to command\.$/.exec(previous.message);
    const counterChange = this.commanderCastCounterChange(current.message);
    if (!movedMatch || !counterChange || counterChange.to <= counterChange.from) {
      return null;
    }

    return {
      ...current,
      message: `${previous.message} ${this.commanderCastCounterMessage(counterChange.from, counterChange.to)}.`,
    };
  }

  private mergeCommanderCastCounter(previous: GameLogEntry, current: GameLogEntry): GameLogEntry | null {
    const previousCounter = this.commanderCastCounterLog(previous.message);
    const currentCounter = this.commanderCastCounterLog(current.message);
    if (!previousCounter || !currentCounter) {
      return null;
    }

    const change = this.resolveCommanderCastCounterChange(previousCounter, currentCounter);
    if (!change) {
      return null;
    }

    const previousDirection = this.commanderCastCounterDirection(previousCounter);
    const currentDirection = Math.sign(change.to - change.from);
    if (currentDirection === 0 || (previousDirection !== 0 && previousDirection !== currentDirection)) {
      return null;
    }

    return {
      ...current,
      message: `${this.commanderCastCounterMessage(change.from, change.to, true)}.`,
    };
  }

  private normalizeCommanderCastCounterEntry(previous: GameLogEntry, current: GameLogEntry): GameLogEntry {
    if (previous.actorId !== current.actorId || current.type !== 'counter.changed') {
      return current;
    }

    const previousCounter = this.commanderCastCounterLog(previous.message);
    const currentCounter = this.commanderCastCounterLog(current.message);
    if (!previousCounter || !currentCounter || 'from' in currentCounter || previousCounter.to === currentCounter.to) {
      return current;
    }

    return {
      ...current,
      message: `${this.commanderCastCounterMessage(previousCounter.to, currentCounter.to)}.`,
    };
  }

  private commanderCastCounterChange(message: string): CommanderCastCounterChange | null {
    const log = this.commanderCastCounterLog(message);
    if (!log) {
      return null;
    }

    return 'from' in log ? log : { from: Math.max(0, log.to - 1), to: log.to };
  }

  private commanderCastCounterLog(message: string): CommanderCastCounterLog | null {
    const rangeMatch = /^Commander cast count (?:increased|decreased) from (\d+) to (\d+)(?: \([+-]\d+(?: clicks)?\))?\.$/.exec(message);
    if (rangeMatch) {
      return { from: Number(rangeMatch[1]), to: Number(rangeMatch[2]) };
    }

    const legacyMatch = /^Set commander:[^ ]+ counter casts to (\d+)\.$/.exec(message);
    if (!legacyMatch) {
      return null;
    }

    const to = Number(legacyMatch[1]);

    return { to };
  }

  private resolveCommanderCastCounterChange(
    previous: CommanderCastCounterLog,
    current: CommanderCastCounterLog,
  ): CommanderCastCounterChange | null {
    if ('from' in current && previous.to === current.from) {
      return 'from' in previous
        ? { from: previous.from, to: current.to }
        : current;
    }

    if (!('from' in current) && previous.to !== current.to) {
      if (!('from' in previous)) {
        return { from: previous.to, to: current.to };
      }

      const previousDirection = Math.sign(previous.to - previous.from);
      const currentDirection = Math.sign(current.to - previous.to);

      return previousDirection !== 0 && previousDirection === currentDirection
        ? { from: previous.from, to: current.to }
        : { from: previous.to, to: current.to };
    }

    return null;
  }

  private commanderCastCounterDirection(log: CommanderCastCounterLog): number {
    return 'from' in log ? Math.sign(log.to - log.from) : 0;
  }

  private commanderCastCounterMessage(from: number, to: number, showClickDelta = false): string {
    const direction = to >= from ? 'increased' : 'decreased';
    const suffix = showClickDelta ? this.clickDeltaSuffix(to - from) : '';

    return `Commander cast count ${direction} from ${from} to ${to}${suffix}`;
  }

  private mergeDraw(previous: GameLogEntry, current: GameLogEntry): GameLogEntry | null {
    if (!current.type.startsWith('library.draw')) {
      return null;
    }

    const previousCount = this.drawCount(previous.message);
    const currentCount = this.drawCount(current.message);
    if (previousCount === null || currentCount === null) {
      return null;
    }

    return {
      ...current,
      message: `ha robado ${previousCount + currentCount} cartas.`,
    };
  }

  private mergeLife(previous: GameLogEntry, current: GameLogEntry): GameLogEntry | null {
    const previousLife = this.lifeChange(previous.message);
    const currentLife = this.lifeChange(current.message);
    if (
      !previousLife
      || !currentLife
      || previousLife.playerName !== ''
        && currentLife.playerName !== ''
        && previousLife.playerName !== currentLife.playerName
    ) {
      return null;
    }

    const currentDirection = Math.sign(currentLife.to - previousLife.to);
    if (currentDirection === 0) {
      return null;
    }

    const previousDirection = previousLife.from === null ? currentDirection : Math.sign(previousLife.to - previousLife.from);
    if (previousDirection !== 0 && previousDirection !== currentDirection) {
      return null;
    }

    const from = previousLife.from ?? previousLife.to - currentDirection;

    return {
      ...current,
      message: this.lifeChangeMessage(previousLife.playerName || currentLife.playerName, from, currentLife.to),
    };
  }

  private lifeChange(message: string): { playerName: string; from: number | null; to: number } | null {
    const setMatch = /^Set (.+) life to (-?\d+)\.$/.exec(message);
    if (setMatch) {
      return { playerName: setMatch[1], from: null, to: Number(setMatch[2]) };
    }

    const subjectChangedMatch = /^(.+) (lost|gained) \d+ life \((-?\d+) -> (-?\d+)\)\.$/.exec(message);
    if (subjectChangedMatch) {
      return {
        playerName: subjectChangedMatch[1],
        from: Number(subjectChangedMatch[3]),
        to: Number(subjectChangedMatch[4]),
      };
    }

    const changedMatch = /^(Lost|Gained) \d+ life \((-?\d+) -> (-?\d+)\)\.$/.exec(message);
    if (!changedMatch) {
      return null;
    }

    return {
      playerName: '',
      from: Number(changedMatch[2]),
      to: Number(changedMatch[3]),
    };
  }

  private lifeChangeMessage(_playerName: string, from: number, to: number): string {
    const delta = to - from;
    const amount = Math.abs(delta);

    return delta < 0
      ? `Lost ${amount} life (${from} -> ${to}).`
      : `Gained ${amount} life (${from} -> ${to}).`;
  }

  private mergeCommanderDamage(previous: GameLogEntry, current: GameLogEntry): GameLogEntry | null {
    const previousDamage = this.commanderDamageChange(previous.message);
    const currentDamage = this.commanderDamageChange(current.message);
    if (
      !previousDamage
      || !currentDamage
      || previousDamage.sourceName !== currentDamage.sourceName
      || previousDamage.targetName !== currentDamage.targetName
    ) {
      return null;
    }

    const currentDirection = Math.sign(currentDamage.to - previousDamage.to);
    const previousDirection = Math.sign(previousDamage.to - previousDamage.from);
    if (currentDirection === 0 || (previousDirection !== 0 && previousDirection !== currentDirection)) {
      return null;
    }

    return {
      ...current,
      message: this.commanderDamageMessage(previousDamage.sourceName, previousDamage.targetName, previousDamage.from, currentDamage.to, true),
    };
  }

  private commanderDamageChange(message: string): CommanderDamageChange | null {
    const match = /^Commander damage from (.+) to (.+) (?:increased|decreased) from (\d+) to (\d+)(?: \([+-]\d+(?: clicks)?\))?\.$/.exec(message);
    if (!match) {
      return null;
    }

    return {
      sourceName: match[1],
      targetName: match[2],
      from: Number(match[3]),
      to: Number(match[4]),
    };
  }

  private commanderDamageMessage(sourceName: string, targetName: string, from: number, to: number, showClickDelta = false): string {
    const direction = to >= from ? 'increased' : 'decreased';
    const suffix = showClickDelta ? this.clickDeltaSuffix(to - from) : '';

    return `Commander damage from ${sourceName} to ${targetName} ${direction} from ${from} to ${to}${suffix}.`;
  }

  private mergePlayerCounter(previous: GameLogEntry, current: GameLogEntry): GameLogEntry | null {
    const previousCounter = this.playerCounterChange(previous.message);
    const currentCounter = this.playerCounterChange(current.message);
    if (
      !previousCounter
      || !currentCounter
      || previousCounter.playerName !== currentCounter.playerName
      || previousCounter.counterName !== currentCounter.counterName
    ) {
      return null;
    }

    const currentDirection = Math.sign(currentCounter.to - previousCounter.to);
    const previousDirection = Math.sign(previousCounter.to - previousCounter.from);
    if (currentDirection === 0 || (previousDirection !== 0 && previousDirection !== currentDirection)) {
      return null;
    }

    return {
      ...current,
      message: this.playerCounterMessage(previousCounter.playerName, previousCounter.counterName, previousCounter.from, currentCounter.to, true),
    };
  }

  private playerCounterChange(message: string): PlayerCounterChange | null {
    const match = /^(.+) ([^ ]+) counter (?:increased|decreased) from (\d+) to (\d+)(?: \([+-]\d+(?: clicks)?\))?\.$/.exec(message);
    if (!match) {
      return null;
    }

    return {
      playerName: match[1],
      counterName: match[2],
      from: Number(match[3]),
      to: Number(match[4]),
    };
  }

  private playerCounterMessage(playerName: string, counterName: string, from: number, to: number, showClickDelta = false): string {
    const direction = to >= from ? 'increased' : 'decreased';
    const suffix = showClickDelta ? this.clickDeltaSuffix(to - from) : '';

    return `${playerName} ${counterName} counter ${direction} from ${from} to ${to}${suffix}.`;
  }

  private clickDeltaSuffix(delta: number): string {
    return ` (${delta > 0 ? '+' : ''}${delta})`;
  }

  private mergePowerToughness(previous: GameLogEntry, current: GameLogEntry): GameLogEntry | null {
    const previousMatch = /^Changed (.+) from (-?\d+|\?)\/(-?\d+|\?) to (-?\d+|\?)\/(-?\d+|\?)\.$/.exec(previous.message);
    const currentMatch = /^Changed (.+) from (-?\d+|\?)\/(-?\d+|\?) to (-?\d+|\?)\/(-?\d+|\?)\.$/.exec(current.message);
    if (!previousMatch || !currentMatch || previousMatch[1] !== currentMatch[1]) {
      return null;
    }

    return {
      ...current,
      message: `Changed ${currentMatch[1]} from ${previousMatch[2]}/${previousMatch[3]} to ${currentMatch[4]}/${currentMatch[5]}.`,
    };
  }

  private mergeLoyalty(previous: GameLogEntry, current: GameLogEntry): GameLogEntry | null {
    const previousLoyalty = this.loyaltyChange(previous.message);
    const currentLoyalty = this.loyaltyChange(current.message);
    if (!previousLoyalty || !currentLoyalty || previousLoyalty.cardName !== currentLoyalty.cardName) {
      return null;
    }

    const previousDirection = Math.sign(previousLoyalty.to - previousLoyalty.from);
    const currentDirection = Math.sign(currentLoyalty.to - previousLoyalty.to);
    if (currentDirection === 0 || (previousDirection !== 0 && previousDirection !== currentDirection)) {
      return null;
    }

    return {
      ...current,
      message: this.loyaltyChangeMessage(currentLoyalty.cardName, previousLoyalty.from, currentLoyalty.to),
    };
  }

  private loyaltyChange(message: string): { cardName: string; from: number; to: number } | null {
    const match = /^(.+) loyalty (?:increased|decreased) from (-?\d+|\?) to (-?\d+|\?) \([+-]?\d+\)\.$/.exec(message);
    if (!match || match[2] === '?' || match[3] === '?') {
      return null;
    }

    return {
      cardName: match[1],
      from: Number(match[2]),
      to: Number(match[3]),
    };
  }

  private loyaltyChangeMessage(cardName: string, from: number, to: number): string {
    const delta = to - from;
    const direction = delta >= 0 ? 'increased' : 'decreased';
    const signedDelta = delta > 0 ? `+${delta}` : `${delta}`;

    return `${cardName} loyalty ${direction} from ${from} to ${to} (${signedDelta}).`;
  }

  private mergeTapped(previous: GameLogEntry, current: GameLogEntry): GameLogEntry | null {
    const previousMatch = /^(Tapped|Untapped|Changed) (.+?)(?: from (tapped|untapped) to (tapped|untapped))?\.$/.exec(previous.message);
    const currentMatch = /^(Tapped|Untapped) (.+)\.$/.exec(current.message);
    if (!previousMatch || !currentMatch || this.tapCardName(previousMatch) !== currentMatch[2]) {
      return null;
    }

    const initialState = this.initialTapState(previousMatch);
    const finalState = currentMatch[1] === 'Tapped' ? 'tapped' : 'untapped';
    if (initialState === finalState) {
      return null;
    }

    return {
      ...current,
      message: `Changed ${currentMatch[2]} from ${initialState} to ${finalState}.`,
    };
  }

  private drawCount(message: string): number | null {
    const match = /^(?:Drew|ha robado) (\d+) (?:cards?|cartas?)\.$/.exec(message);

    return match ? Number(match[1]) : null;
  }

  private tapCardName(match: RegExpExecArray): string {
    return match[1] === 'Changed' ? match[2] : match[2];
  }

  private initialTapState(match: RegExpExecArray): 'tapped' | 'untapped' {
    if (match[1] === 'Changed' && (match[3] === 'tapped' || match[3] === 'untapped')) {
      return match[3];
    }

    return match[1] === 'Tapped' ? 'untapped' : 'tapped';
  }
}
