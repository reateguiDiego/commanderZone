import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'commanderzone.missing-watchlist';

export interface MissingWatchItem {
  name: string;
  sourceDeckId: string;
  addedAt: string;
}

@Injectable({ providedIn: 'root' })
export class MissingCardsStore {
  readonly watchlist = signal<MissingWatchItem[]>(this.read());
  private readonly ignored = new Set<string>();

  add(name: string, sourceDeckId: string): void {
    const normalized = this.normalize(name);
    const current = this.watchlist();
    if (current.some((item) => this.normalize(item.name) === normalized)) {
      return;
    }

    this.write([
      { name, sourceDeckId, addedAt: new Date().toISOString() },
      ...current,
    ]);
  }

  remove(name: string): void {
    const normalized = this.normalize(name);
    this.write(this.watchlist().filter((item) => this.normalize(item.name) !== normalized));
  }

  ignoreForSession(name: string): void {
    this.ignored.add(this.normalize(name));
  }

  isIgnored(name: string): boolean {
    return this.ignored.has(this.normalize(name));
  }

  isWatched(name: string): boolean {
    const normalized = this.normalize(name);

    return this.watchlist().some((item) => this.normalize(item.name) === normalized);
  }

  private write(items: MissingWatchItem[]): void {
    this.watchlist.set(items);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  private read(): MissingWatchItem[] {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(raw);

      return Array.isArray(parsed) ? parsed.filter((item): item is MissingWatchItem => this.isItem(item)) : [];
    } catch {
      localStorage.removeItem(STORAGE_KEY);

      return [];
    }
  }

  private isItem(item: unknown): item is MissingWatchItem {
    return typeof item === 'object'
      && item !== null
      && typeof (item as MissingWatchItem).name === 'string'
      && typeof (item as MissingWatchItem).sourceDeckId === 'string';
  }

  private normalize(name: string): string {
    return name.trim().toLowerCase();
  }
}
