import { Injectable, signal } from '@angular/core';
import { ManaCometEffect } from '../components/mana-comet-layer/mana-comet-layer.component';
import { ManaAddition, ManaPoolColor } from '../utils/mana-source-detector';

interface ViewportPoint {
  readonly x: number;
  readonly y: number;
}

const MANA_COMET_DURATION_MS = 880;
const MANA_COMET_STAGGER_MS = 92;
const MANA_COMET_MAX_UNITS_PER_ADDITION = 3;

@Injectable()
export class GameTableManaCometService {
  readonly effects = signal<readonly ManaCometEffect[]>([]);

  private sequence = 0;

  animateFromSource(source: ViewportPoint, additions: readonly ManaAddition[], completed?: () => void): boolean {
    if (additions.length === 0) {
      return false;
    }

    const effects = this.effectsForAdditions(source, additions);
    if (effects.length === 0) {
      return false;
    }

    this.effects.update((current) => [...current, ...effects]);
    for (const effect of effects) {
      window.setTimeout(() => this.remove(effect.id), MANA_COMET_DURATION_MS + effect.delayMs + 80);
    }

    if (completed) {
      const latestDelay = Math.max(...effects.map((effect) => effect.delayMs));
      window.setTimeout(completed, MANA_COMET_DURATION_MS + latestDelay);
    }

    return true;
  }

  private effectsForAdditions(source: ViewportPoint, additions: readonly ManaAddition[]): readonly ManaCometEffect[] {
    const effects: ManaCometEffect[] = [];

    for (const addition of additions) {
      const target = this.targetPoint(addition.color);
      if (!target) {
        continue;
      }

      const unitCount = Math.max(1, Math.min(addition.amount, MANA_COMET_MAX_UNITS_PER_ADDITION));
      for (let index = 0; index < unitCount; index += 1) {
        effects.push(this.createEffect(addition.color, source, target, effects.length));
      }
    }

    return effects;
  }

  private createEffect(color: ManaPoolColor, source: ViewportPoint, target: ViewportPoint, index: number): ManaCometEffect {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.hypot(dx, dy);

    return {
      id: `mana-comet-${++this.sequence}`,
      color,
      startX: source.x,
      startY: source.y,
      endX: target.x,
      endY: target.y,
      angleDeg: Math.atan2(dy, dx) * 180 / Math.PI,
      trailLength: Math.max(48, Math.min(148, distance * 0.18)),
      delayMs: index * MANA_COMET_STAGGER_MS,
    };
  }

  private targetPoint(color: ManaPoolColor): ViewportPoint | null {
    const target = Array.from(document.querySelectorAll<HTMLElement>(`[data-mana-pool-color="${color}"]`))
      .find((element) => this.isVisibleElement(element));
    const bounds = target?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      return null;
    }

    return {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    };
  }

  private isVisibleElement(element: HTMLElement): boolean {
    const bounds = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return bounds.width > 0
      && bounds.height > 0
      && style.visibility !== 'hidden'
      && style.display !== 'none';
  }

  private remove(id: string): void {
    this.effects.update((current) => current.filter((effect) => effect.id !== id));
  }
}
