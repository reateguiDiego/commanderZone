import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnDestroy, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { CARD_SEARCH_LIMIT, CardsApi } from '../../../../../core/api/cards.api';
import { Card } from '../../../../../core/models/card.model';
import { GameSpecialEntity } from '../../../../../core/models/game.model';
import { AppModalComponent } from '../../../../../shared/ui/app-modal/app-modal.component';
import { PrettyScrollDirective } from '../../../../../shared/ui/pretty-scroll/pretty-scroll.directive';
import { filterDistinctCardsByQuery, sanitizeCardSearchQuery } from '../../../../../shared/utils/card-search';
import { GameTablePlayerSpecialEntitiesSummary } from '../../state/helpers/game-table-special-entities.state';

export type HelperQuickAction = 'monarch' | 'initiative' | 'citys_blessing' | 'the_ring' | 'set_day' | 'set_night';

export interface HelperCardSelection {
  readonly template: 'emblem' | 'dungeon';
  readonly card: Card;
}

export interface HelperEntityStateUpdate {
  readonly entityId: string;
  readonly state: Record<string, unknown>;
}

@Component({
  selector: 'app-special-helper-modal',
  imports: [RuntimeTranslatePipe, FormsModule, LucideAngularModule, AppModalComponent, PrettyScrollDirective],
  templateUrl: './special-helper-modal.component.html',
  styleUrl: './special-helper-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpecialHelperModalComponent implements OnDestroy {
  private readonly cardsApi = inject(CardsApi);

  readonly query = signal('');
  readonly searchKind = signal<'emblem' | 'dungeon'>('emblem');
  readonly searchResults = signal<Card[]>([]);
  readonly searching = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly hasQuery = computed(() => this.query().trim().length >= 2);

  @Input() open = false;
  @Input() pending = false;
  @Input() interactionMode: 'readonly' | 'editable' = 'editable';
  @Input() playerName = '';
  @Input() playerSummary: GameTablePlayerSpecialEntitiesSummary | null = null;
  @Input() dayNightEntity: GameSpecialEntity | null = null;
  @Input() ringBearerName: (entity: GameSpecialEntity) => string | null = () => null;

  @Output() closed = new EventEmitter<void>();
  @Output() quickActionSelected = new EventEmitter<HelperQuickAction>();
  @Output() cardSelected = new EventEmitter<HelperCardSelection>();
  @Output() entityUpdated = new EventEmitter<HelperEntityStateUpdate>();
  @Output() entityRemoved = new EventEmitter<string>();

  private searchTimeout: ReturnType<typeof setTimeout> | null = null;
  private searchVersion = 0;

  ngOnDestroy(): void {
    this.clearSearchTimeout();
  }

  canEdit(): boolean {
    return this.interactionMode === 'editable' && !this.pending;
  }

  activePlayerEntities(): readonly GameSpecialEntity[] {
    const summary = this.playerSummary;
    if (!summary) {
      return [];
    }

    return [
      ...(summary.monarch ? [summary.monarch] : []),
      ...(summary.initiative ? [summary.initiative] : []),
      ...(summary.citysBlessing ? [summary.citysBlessing] : []),
      ...(summary.ring ? [summary.ring] : []),
      ...(summary.dungeon ? [summary.dungeon] : []),
      ...summary.emblems,
    ];
  }

  ringEntity(): GameSpecialEntity | null {
    return this.playerSummary?.ring ?? null;
  }

  ringLevel(): number | null {
    const ring = this.ringEntity();
    return ring && typeof ring.state['level'] === 'number' ? ring.state['level'] : null;
  }

  ringBearer(): string | null {
    const ring = this.ringEntity();
    return ring ? this.ringBearerName(ring) : null;
  }

  dayNightMode(): 'day' | 'night' | null {
    if (!this.dayNightEntity) {
      return null;
    }

    const mode = this.dayNightEntity.state['mode'];
    return mode === 'day' || mode === 'night' ? mode : null;
  }

  setQuickAction(action: HelperQuickAction): void {
    if (!this.canEdit()) {
      return;
    }

    this.quickActionSelected.emit(action);
  }

  setSearchKind(kind: 'emblem' | 'dungeon'): void {
    if (!this.canEdit() || this.searchKind() === kind) {
      return;
    }

    this.searchKind.set(kind);
    this.searchResults.set([]);
    this.errorKey.set(null);
    if (this.hasQuery()) {
      void this.searchHelpers(this.query().trim(), ++this.searchVersion);
    }
  }

  onQueryInput(value: string): void {
    if (!this.canEdit()) {
      return;
    }

    const query = sanitizeCardSearchQuery(value);
    this.query.set(query);
    this.clearSearchTimeout();

    if (query.trim().length < 2) {
      this.searchResults.set([]);
      this.searching.set(false);
      this.errorKey.set(null);
      return;
    }

    this.searching.set(true);
    const version = ++this.searchVersion;
    this.searchTimeout = setTimeout(() => {
      void this.searchHelpers(query.trim(), version);
    }, 320);
  }

  selectCard(card: Card): void {
    if (!this.canEdit()) {
      return;
    }

    this.cardSelected.emit({
      template: this.searchKind(),
      card,
    });
  }

  close(): void {
    if (this.pending) {
      return;
    }

    this.closed.emit();
  }

  imageFor(card: Card): string | null {
    return card.imageUris.normal
      ?? card.imageUris.large
      ?? card.imageUris.small
      ?? card.cardFaces?.[0]?.imageUris.normal
      ?? card.cardFaces?.[0]?.imageUris.large
      ?? card.cardFaces?.[0]?.imageUris.small
      ?? null;
  }

  entityImage(entity: GameSpecialEntity): string | null {
    return entity.card?.imageUris?.normal
      ?? entity.card?.imageUris?.large
      ?? entity.card?.imageUris?.small
      ?? entity.card?.cardFaces?.[0]?.imageUris?.normal
      ?? entity.card?.cardFaces?.[0]?.imageUris?.large
      ?? entity.card?.cardFaces?.[0]?.imageUris?.small
      ?? null;
  }

  entityLabel(entity: GameSpecialEntity): string {
    return `game.specialHelpers.labels.${entity.template}`;
  }

  dungeonRoom(entity: GameSpecialEntity): string | null {
    return typeof entity.state['roomName'] === 'string' ? entity.state['roomName'] : null;
  }

  removeEntity(entity: GameSpecialEntity): void {
    if (!this.canEdit()) {
      return;
    }

    this.entityRemoved.emit(entity.id);
  }

  increaseRingLevel(): void {
    const ring = this.ringEntity();
    const level = this.ringLevel();
    if (!ring || level === null || !this.canEdit() || level >= 4) {
      return;
    }

    this.entityUpdated.emit({
      entityId: ring.id,
      state: {
        level: level + 1,
        ringBearerInstanceId: typeof ring.state['ringBearerInstanceId'] === 'string' ? ring.state['ringBearerInstanceId'] : null,
      },
    });
  }

  decreaseRingLevel(): void {
    const ring = this.ringEntity();
    const level = this.ringLevel();
    if (!ring || level === null || !this.canEdit() || level <= 1) {
      return;
    }

    this.entityUpdated.emit({
      entityId: ring.id,
      state: {
        level: level - 1,
        ringBearerInstanceId: typeof ring.state['ringBearerInstanceId'] === 'string' ? ring.state['ringBearerInstanceId'] : null,
      },
    });
  }

  clearRingBearer(): void {
    const ring = this.ringEntity();
    const level = this.ringLevel();
    if (!ring || level === null || !this.canEdit()) {
      return;
    }

    this.entityUpdated.emit({
      entityId: ring.id,
      state: {
        level,
        ringBearerInstanceId: null,
      },
    });
  }

  private async searchHelpers(query: string, version: number): Promise<void> {
    try {
      const gameplayKind = this.searchKind();
      const response = await firstValueFrom(this.cardsApi.search(query, 1, CARD_SEARCH_LIMIT, {
        gameplayKind,
      }));
      if (version !== this.searchVersion || query !== this.query().trim()) {
        return;
      }

      let results = filterDistinctCardsByQuery(response.data, query);
      if (results.length === 0) {
        const fallbackResponse = await firstValueFrom(this.cardsApi.search('', 1, CARD_SEARCH_LIMIT, {
          gameplayKind,
        }));
        if (version !== this.searchVersion || query !== this.query().trim()) {
          return;
        }

        results = filterDistinctCardsByQuery(fallbackResponse.data, '');
      }

      this.searchResults.set(results);
      this.errorKey.set(null);
    } catch {
      if (version === this.searchVersion) {
        this.searchResults.set([]);
        this.errorKey.set('game.specialHelpers.modal.searchError');
      }
    } finally {
      if (version === this.searchVersion) {
        this.searching.set(false);
      }
    }
  }

  private clearSearchTimeout(): void {
    if (this.searchTimeout === null) {
      return;
    }

    clearTimeout(this.searchTimeout);
    this.searchTimeout = null;
  }
}
