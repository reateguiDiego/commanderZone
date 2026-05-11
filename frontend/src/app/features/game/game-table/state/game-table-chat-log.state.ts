import { Injectable, signal } from '@angular/core';
import { GameCardInstance, GameSnapshot, GameZoneName } from '../../../../core/models/game.model';

type GameLogEntry = GameSnapshot['eventLog'][number];

export interface GameLogEntryView extends GameLogEntry {
  card: GameCardInstance | null;
  messagePrefix: string;
  messageSuffix: string;
  appearance: 'default' | 'phase';
}

@Injectable()
export class GameTableChatLogState {
  readonly chatMessage = signal('');

  normalizedMessage(): string {
    return this.chatMessage().trim();
  }

  setMessage(value: string): void {
    this.chatMessage.set(value);
  }

  clearMessage(): void {
    this.chatMessage.set('');
  }

  eventLog(snapshot: GameSnapshot | null): GameLogEntry[] {
    return this.compactLog([...(snapshot?.eventLog ?? [])].filter((entry) => entry.type !== 'card.position.changed' && entry.message !== 'Reordered hand.'));
  }

  eventLogView(snapshot: GameSnapshot | null, zones: readonly GameZoneName[]): GameLogEntryView[] {
    return this.eventLog(snapshot).map((entry) => this.toLogEntryView(snapshot, zones, entry));
  }

  private toLogEntryView(snapshot: GameSnapshot | null, zones: readonly GameZoneName[], entry: GameLogEntry): GameLogEntryView {
    const card = this.cardFromLogEntry(snapshot, zones, entry);
    if (!card) {
      return { ...entry, card: null, messagePrefix: entry.message, messageSuffix: '', appearance: this.logAppearance(entry) };
    }

    const index = entry.message.indexOf(card.name);

    return {
      ...entry,
      card,
      messagePrefix: index >= 0 ? entry.message.slice(0, index) : entry.message,
      messageSuffix: index >= 0 ? entry.message.slice(index + card.name.length) : '',
      appearance: this.logAppearance(entry),
    };
  }

  private logAppearance(entry: GameLogEntry): GameLogEntryView['appearance'] {
    return entry.type === 'turn.changed' ? 'phase' : 'default';
  }

  private cardFromLogEntry(snapshot: GameSnapshot | null, zones: readonly GameZoneName[], entry: GameLogEntry): GameCardInstance | null {
    if (!entry.message) {
      return null;
    }

    return this.allCards(snapshot, zones)
      .filter((card) => !card.hidden && card.name.length > 2 && entry.message.includes(card.name))
      .sort((left, right) => right.name.length - left.name.length)[0] ?? null;
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
        compact.push(entry);
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
      ?? this.mergePowerToughness(previous, current)
      ?? this.mergeTapped(previous, current);
  }

  private mergeCommanderCast(previous: GameLogEntry, current: GameLogEntry): GameLogEntry | null {
    if (previous.actorId !== current.actorId || previous.type !== 'card.moved' || current.type !== 'counter.changed') {
      return null;
    }

    const movedMatch = /^Moved (.+) from command to battlefield\.$/.exec(previous.message);
    const counterMatch = /^Set commander:[^ ]+ counter casts to (\d+)\.$/.exec(current.message);
    if (!movedMatch || !counterMatch) {
      return null;
    }

    const next = Number(counterMatch[1]);

    return {
      ...current,
      message: `${previous.message} Commander cast count increased from ${Math.max(0, next - 1)} to ${next}.`,
    };
  }

  private mergeCommanderMoveSequence(previous: GameLogEntry, current: GameLogEntry): GameLogEntry | null {
    if (previous.actorId !== current.actorId || previous.type !== 'card.moved') {
      return null;
    }

    const returnedMatch = /^Moved (.+) from battlefield to command\.$/.exec(previous.message);
    const castMatch = /^Moved (.+) from command to battlefield\. Commander cast count increased from (\d+) to (\d+)\.$/.exec(current.message);
    if (!returnedMatch || !castMatch || returnedMatch[1] !== castMatch[1]) {
      return null;
    }

    return {
      ...current,
      message: `${previous.message} Commander cast count increased from ${castMatch[2]} to ${castMatch[3]}.`,
    };
  }

  private mergeCommanderReturnCast(previous: GameLogEntry, current: GameLogEntry): GameLogEntry | null {
    if (previous.actorId !== current.actorId || previous.type !== 'card.moved' || current.type !== 'counter.changed') {
      return null;
    }

    const movedMatch = /^Moved (.+) from battlefield to command\.$/.exec(previous.message);
    const counterMatch = /^Set commander:[^ ]+ counter casts to (\d+)\.$/.exec(current.message);
    if (!movedMatch || !counterMatch) {
      return null;
    }

    const next = Number(counterMatch[1]);

    return {
      ...current,
      message: `${previous.message} Commander cast count increased from ${Math.max(0, next - 1)} to ${next}.`,
    };
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
      message: `Drew ${previousCount + currentCount} cards.`,
    };
  }

  private mergeLife(previous: GameLogEntry, current: GameLogEntry): GameLogEntry | null {
    const previousLife = this.lifeChange(previous.message);
    const currentLife = this.lifeChange(current.message);
    if (!previousLife || !currentLife || previousLife.playerName !== currentLife.playerName) {
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
      message: this.lifeChangeMessage(previousLife.playerName, from, currentLife.to),
    };
  }

  private lifeChange(message: string): { playerName: string; from: number | null; to: number } | null {
    const setMatch = /^Set (.+) life to (-?\d+)\.$/.exec(message);
    if (setMatch) {
      return { playerName: setMatch[1], from: null, to: Number(setMatch[2]) };
    }

    const changedMatch = /^(.+) (lost|gained) \d+ life \((-?\d+) -> (-?\d+)\)\.$/.exec(message);
    if (!changedMatch) {
      return null;
    }

    return {
      playerName: changedMatch[1],
      from: Number(changedMatch[3]),
      to: Number(changedMatch[4]),
    };
  }

  private lifeChangeMessage(playerName: string, from: number, to: number): string {
    const delta = to - from;
    const amount = Math.abs(delta);

    return delta < 0
      ? `${playerName} lost ${amount} life (${from} -> ${to}).`
      : `${playerName} gained ${amount} life (${from} -> ${to}).`;
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

  private mergeTapped(previous: GameLogEntry, current: GameLogEntry): GameLogEntry | null {
    const previousMatch = /^(Tapped|Untapped|Changed) (.+?)(?: from (tapped|untapped) to (tapped|untapped))?\.$/.exec(previous.message);
    const currentMatch = /^(Tapped|Untapped) (.+)\.$/.exec(current.message);
    if (!previousMatch || !currentMatch || this.tapCardName(previousMatch) !== currentMatch[2]) {
      return null;
    }

    return {
      ...current,
      message: `Changed ${currentMatch[2]} from ${this.initialTapState(previousMatch)} to ${currentMatch[1] === 'Tapped' ? 'tapped' : 'untapped'}.`,
    };
  }

  private drawCount(message: string): number | null {
    const match = /^Drew (\d+) cards?\.$/.exec(message);

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
