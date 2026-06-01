import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { ManaSymbolsComponent } from '../../../../../shared/mana/mana-symbols/mana-symbols.component';
import { ManaPool } from '../../state/mana/game-table-mana-pool.state';
import { ManaPoolColor } from '../../utils/mana-source-detector';

const IDENTITY_MANA_COLORS: readonly ManaPoolColor[] = ['W', 'U', 'B', 'R', 'G'];
const MANA_POOL_COLORS: readonly ManaPoolColor[] = [...IDENTITY_MANA_COLORS, 'C'];
const ANY_COLOR_MANA_SYMBOLS: readonly ManaPoolColor[] = ['W', 'U', 'B', 'R', 'G'];
const MANA_TYPE_NAMES: Readonly<Record<ManaPoolColor, string>> = {
  W: 'White mana',
  U: 'Blue mana',
  B: 'Black mana',
  R: 'Red mana',
  G: 'Green mana',
  C: 'Colorless mana',
};
const BACKGROUND_CONTRAST_MANA_COLOR: Readonly<Record<ManaPoolColor, ManaPoolColor>> = {
  W: 'B',
  U: 'R',
  B: 'W',
  R: 'U',
  G: 'R',
  C: 'W',
};
const MANA_SYMBOL_PAINT_COLORS: Readonly<Record<ManaPoolColor, string>> = {
  W: '#fff833',
  U: '#00d9ff',
  B: '#d100ff',
  R: '#ff2d00',
  G: '#39ff14',
  C: '#f4f7ff',
};
const MAX_MANA_POOL_AMOUNT = 99;

export function contrastManaColorForBackground(backgroundName: string | null | undefined): ManaPoolColor {
  const backgroundColor = backgroundName?.trim().split('_')[0]?.toUpperCase();

  return isManaPoolColor(backgroundColor) ? BACKGROUND_CONTRAST_MANA_COLOR[backgroundColor] : 'W';
}

function isManaPoolColor(value: string | undefined): value is ManaPoolColor {
  return value === 'W' || value === 'U' || value === 'B' || value === 'R' || value === 'G' || value === 'C';
}

@Component({
  selector: 'app-mana-pool-panel',
  imports: [LucideAngularModule, ManaSymbolsComponent],
  templateUrl: './mana-pool-panel.component.html',
  styleUrl: './mana-pool-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManaPoolPanelComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly pool = input.required<ManaPool>();
  readonly backgroundName = input<string | null | undefined>(null);
  readonly colorIdentity = input<readonly string[] | null | undefined>(IDENTITY_MANA_COLORS);

  readonly colorAdded = output<ManaPoolColor>();
  readonly colorRemoved = output<ManaPoolColor>();
  readonly colorReset = output<ManaPoolColor>();
  readonly anyAdded = output<void>();
  readonly anyRemoved = output<void>();
  readonly anyReset = output<void>();
  readonly poolReset = output<void>();
  readonly hidden = output<void>();

  readonly activeControls = signal<string | null>(null);
  readonly resetMenuOpen = signal(false);
  readonly colors = computed<readonly ManaPoolColor[]>(() => {
    const identity = new Set((this.colorIdentity() ?? []).map((color) => color.toUpperCase()));
    const visibleIdentityColors = IDENTITY_MANA_COLORS.filter((color) => identity.has(color));

    return [...visibleIdentityColors, 'C'];
  });
  readonly anyColorSymbols = ANY_COLOR_MANA_SYMBOLS;
  readonly visibleColorCount = computed(() => this.colors().length);
  readonly total = computed(() => this.anyValue() + MANA_POOL_COLORS.reduce((sum, color) => sum + this.pool()[color], 0));
  readonly symbolColor = computed(() => contrastManaColorForBackground(this.backgroundName()));
  readonly symbolColorStyle = computed(() => MANA_SYMBOL_PAINT_COLORS[this.symbolColor()]);

  activateControls(key: string, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.resetMenuOpen.set(false);
    this.activeControls.set(key);
  }

  openResetMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.activeControls.set(null);
    this.resetMenuOpen.set(true);
  }

  resetPool(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.resetMenuOpen.set(false);
    this.poolReset.emit();
  }

  hidePanel(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.resetMenuOpen.set(false);
    this.hidden.emit();
  }

  canAddAny(): boolean {
    return this.anyValue() < MAX_MANA_POOL_AMOUNT;
  }

  canAdd(color: ManaPoolColor): boolean {
    return this.value(color) < MAX_MANA_POOL_AMOUNT;
  }

  anyValue(): number {
    return this.pool().ANY;
  }

  value(color: ManaPoolColor): number {
    return this.pool()[color];
  }

  manaTypeName(color: ManaPoolColor): string {
    return MANA_TYPE_NAMES[color];
  }

  @HostListener('document:mousedown', ['$event'])
  closeTransientControls(event: MouseEvent): void {
    const target = event.target instanceof Node ? event.target : null;
    if (target && this.host.nativeElement.contains(target)) {
      return;
    }

    this.activeControls.set(null);
    this.resetMenuOpen.set(false);
  }
}
