import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { GameCardInstance, GameZoneName } from '../../../../../core/models/game.model';
import { PlayerView } from '../../game-table.store';
import { OpponentCardsTargetComponent } from '../opponent-cards-target/opponent-cards-target.component';
import { OpponentCardsTargetCard } from '../../models/opponent-cards-target-card.model';
import { OpponentMiniBattlefieldComponent } from '../opponent-mini-battlefield/opponent-mini-battlefield.component';
import { CardPreviewEvent } from '../../models/card-preview.model';
import { OpponentTargetingPill } from '../../models/opponent-targeting-pill.model';
import { PLAYER_DEFEATED_SKULL_IMAGE } from '../../utils/game-table-visual-assets';
import { playerIsDefeated } from '../../utils/game-player-defeat';
import { GameTableLongPressDirective } from '../../directives/game-table-long-press.directive';

interface PlayerDropEvent {
  event: DragEvent;
  playerId: string;
}

interface PlayerMenuEvent {
  event: MouseEvent;
  playerId: string;
}

type OpponentCountZone = Extract<GameZoneName, 'hand' | 'library' | 'graveyard' | 'exile'>;
type OpponentZoneIcon = 'hand-fan' | 'deck' | 'grave' | 'ban';
type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G';

interface OpponentZoneSummary {
  zone: OpponentCountZone;
  icon: OpponentZoneIcon;
  title: string;
}

interface BattlefieldLayoutSize {
  readonly width: number;
  readonly height: number;
}

const MANA_COLOR_ORDER: readonly ManaColor[] = ['W', 'U', 'B', 'R', 'G'];
const MANA_GRADIENT_COLORS: Record<ManaColor, string> = {
  W: '#fff0bd',
  U: '#36b8ff',
  B: '#000000',
  R: '#ff5b36',
  G: '#4fd36b',
};
const MANA_BORDER_COLORS: Record<ManaColor, string> = {
  W: '#d9ccb4',
  U: '#7faeca',
  B: '#9c8aac',
  R: '#c77a62',
  G: '#7faa7b',
};
const COLORLESS_GRADIENT_COLORS = ['#ded8bf', '#7c7a70'];
const PLAYER_BORDER_VARIANTS = ['#f3dfaa', '#cdd7de', '#cdb8d5', '#d8b6a6', '#bcd1b4', '#bfc3a2', '#b7a6a0'] as const;

@Component({
  selector: 'app-opponent-mini-board',
  imports: [LucideAngularModule, OpponentMiniBattlefieldComponent, OpponentCardsTargetComponent, GameTableLongPressDirective],
  templateUrl: './opponent-mini-board.component.html',
  styleUrl: './opponent-mini-board.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpponentMiniBoardComponent {
  readonly defeatedSkullImage = PLAYER_DEFEATED_SKULL_IMAGE;
  readonly opponentZoneSummaries: readonly OpponentZoneSummary[] = [
    { zone: 'hand', icon: 'hand-fan', title: 'Hand' },
    { zone: 'library', icon: 'deck', title: 'Library' },
    { zone: 'graveyard', icon: 'grave', title: 'Graveyard' },
    { zone: 'exile', icon: 'ban', title: 'Exile' },
  ];

  readonly player = input.required<PlayerView>();
  readonly colorAccent = input.required<(player: PlayerView | null) => string>();
  readonly deckLabel = input.required<(player: PlayerView | null) => string>();
  readonly backgroundImage = input.required<(player: PlayerView | null) => string>();
  readonly battlefieldSize = input.required<BattlefieldLayoutSize>();
  readonly zoneCount = input.required<(player: PlayerView, zone: GameZoneName) => number>();
  readonly cardPosition = input.required<(card: GameCardInstance) => { x: number; y: number } | null>();
  readonly cardImage = input.required<(card: GameCardInstance) => string | null>();
  readonly isPlayerDropHighlighted = input.required<(playerId: string) => boolean>();
  readonly isCardDropSettling = input<(playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean>(() => false);
  readonly isManaDropSettling = input<(playerId: string, card: GameCardInstance) => boolean>(() => false);
  readonly isBattlefieldEntrySettling = input<(playerId: string, card: GameCardInstance) => boolean>(() => false);
  readonly isCommanderEntrySettling = input<(playerId: string, card: GameCardInstance) => boolean>(() => false);
  readonly isCardTransferPending = input<(playerId: string, zone: GameZoneName, card: GameCardInstance) => boolean>(() => false);
  readonly arrowTargeting = input(false);
  readonly isActiveTurnPlayer = input(false);
  readonly targetingPill = input<OpponentTargetingPill | null>(null);
  readonly cardsTargetCards = input<readonly OpponentCardsTargetCard[]>([]);

  readonly focusPlayer = output<string>();
  readonly dropAllowed = output<DragEvent>();
  readonly playerDropped = output<PlayerDropEvent>();
  readonly playerMenuOpened = output<PlayerMenuEvent>();
  readonly cardPreviewShown = output<CardPreviewEvent>();
  readonly cardPreviewHidden = output<void>();
  readonly battlefieldCardClicked = output<{ event: MouseEvent; playerId: string; card: GameCardInstance }>();

  zoneCountTooltip(player: PlayerView, summary: OpponentZoneSummary): string {
    return `${summary.title}: ${this.zoneCount()(player, summary.zone)}`;
  }

  defeatedBackgroundImageCss(player: PlayerView): string | null {
    const image = this.backgroundImage()(player).trim();

    return image ? `url("${image.replace(/"/g, '\\"')}")` : null;
  }

  isDefeated(player: PlayerView): boolean {
    return playerIsDefeated(player);
  }

  identityGradient(player: PlayerView): string {
    const colors = this.identityGradientColors(player);

    if (colors.length === 1) {
      return `linear-gradient(135deg, ${colors[0]} 0%, color-mix(in srgb, ${colors[0]} 44%, #050605) 100%)`;
    }

    return `linear-gradient(135deg, ${this.balancedGradientStops(colors).join(', ')})`;
  }

  identityPrimaryColor(player: PlayerView): string {
    return this.identityGradientColors(player)[0] ?? COLORLESS_GRADIENT_COLORS[0];
  }

  identitySecondaryColor(player: PlayerView): string {
    const colors = this.identityGradientColors(player);

    return colors.at(-1) ?? COLORLESS_GRADIENT_COLORS[1];
  }

  identityTextColor(player: PlayerView): string {
    const colors = this.identityColors(player);

    return colors.length === 1 && colors[0] === 'W' ? '#1d1608' : '#fff8dd';
  }

  deckBorderColor(player: PlayerView): string {
    const identityColors = this.identityColors(player);
    const baseColors = identityColors.length > 0
      ? identityColors.map((color) => MANA_BORDER_COLORS[color])
      : ['#a8a091'];
    const base = baseColors[this.stableIndex(player.id, baseColors.length)] ?? baseColors[0];
    const variantSeed = `${player.id}:${this.deckLabel()(player)}`;
    const variant = PLAYER_BORDER_VARIANTS[this.stableIndex(variantSeed, PLAYER_BORDER_VARIANTS.length)];

    return this.mixHexColors(base, variant, 0.28);
  }

  private identityColors(player: PlayerView): ManaColor[] {
    const identity = player.state.colorIdentity ?? [];

    return MANA_COLOR_ORDER.filter((color) => identity.includes(color));
  }

  private identityGradientColors(player: PlayerView): readonly string[] {
    const identityColors = this.identityColors(player);

    return identityColors.length > 0
      ? identityColors.map((color) => MANA_GRADIENT_COLORS[color])
      : COLORLESS_GRADIENT_COLORS;
  }

  private balancedGradientStops(colors: readonly string[]): readonly string[] {
    const segmentSize = 100 / colors.length;
    const transitionSize = Math.min(7, segmentSize * 0.22);

    return colors.flatMap((color, index) => {
      const start = index * segmentSize;
      const end = (index + 1) * segmentSize;
      const stableStart = index === 0 ? start : start + transitionSize;
      const stableEnd = index === colors.length - 1 ? end : end - transitionSize;

      return [`${color} ${this.gradientStop(stableStart)}`, `${color} ${this.gradientStop(stableEnd)}`];
    });
  }

  private gradientStop(value: number): string {
    const rounded = Number(value.toFixed(3));

    return `${rounded}%`;
  }

  private stableIndex(seed: string, length: number): number {
    if (length <= 1) {
      return 0;
    }

    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
      hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
    }

    return Math.abs(hash) % length;
  }

  private mixHexColors(base: string, tint: string, tintWeight: number): string {
    const baseRgb = this.hexToRgb(base);
    const tintRgb = this.hexToRgb(tint);
    const baseWeight = 1 - tintWeight;
    const mixed = baseRgb.map((channel, index) => Math.round(channel * baseWeight + tintRgb[index] * tintWeight));

    return `rgb(${mixed[0]} ${mixed[1]} ${mixed[2]})`;
  }

  private hexToRgb(hex: string): [number, number, number] {
    const normalized = hex.replace('#', '');
    const value = Number.parseInt(normalized.length === 3
      ? normalized.split('').map((character) => `${character}${character}`).join('')
      : normalized, 16);

    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }
}
