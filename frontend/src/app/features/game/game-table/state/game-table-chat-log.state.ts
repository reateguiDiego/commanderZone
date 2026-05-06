import { Injectable, signal } from '@angular/core';
import { GameSnapshot } from '../../../../core/models/game.model';

type GameLogEntry = GameSnapshot['eventLog'][number];

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

  private compactLog(entries: GameLogEntry[]): GameLogEntry[] {
    return entries.reduce<GameLogEntry[]>((compact, entry) => {
      const previous = compact.at(-1);
      const merged = previous ? this.mergeEntries(previous, entry) : null;
      if (merged) {
        compact[compact.length - 1] = merged;
      } else {
        compact.push(entry);
      }

      return compact;
    }, []);
  }

  private mergeEntries(previous: GameLogEntry, current: GameLogEntry): GameLogEntry | null {
    const commanderCast = this.mergeCommanderCast(previous, current);
    if (commanderCast) {
      return commanderCast;
    }

    if (previous.actorId !== current.actorId || previous.type !== current.type) {
      return null;
    }

    return this.mergeDraw(previous, current)
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
