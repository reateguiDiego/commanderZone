import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { GameCardInstance, GameZoneName } from '../../../../core/models/game.model';
import { PlayerView } from '../game-table.store';
import { OpponentCardsTargetComponent } from '../opponent-cards-target/opponent-cards-target.component';
import { OpponentCardsTargetCard } from '../opponent-cards-target-card.model';
import { OpponentMiniBattlefieldComponent } from '../opponent-mini-battlefield/opponent-mini-battlefield.component';
import { CardPreviewEvent } from '../card-preview.model';
import { OpponentTargetingPill } from '../opponent-targeting-pill.model';
import { PLAYER_DEFEATED_SKULL_IMAGE } from '../game-table-visual-assets';

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

interface OpponentZoneSummary {
  zone: OpponentCountZone;
  icon: OpponentZoneIcon;
  title: string;
}

interface BattlefieldLayoutSize {
  readonly width: number;
  readonly height: number;
}

@Component({
  selector: 'app-opponent-mini-board',
  imports: [LucideAngularModule, OpponentMiniBattlefieldComponent, OpponentCardsTargetComponent],
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
}
