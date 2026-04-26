import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { CardsApi } from '../../core/api/cards.api';
import { DecksApi } from '../../core/api/decks.api';
import { Card } from '../../core/models/card.model';
import { CommanderValidation, Deck, DeckCard, DeckSection, DeckToken, UnresolvedDeckToken } from '../../core/models/deck.model';
import { MissingDeckCard } from '../../core/models/api-responses.model';
import { ManaSymbolsComponent } from '../../shared/mana/mana-symbols.component';
import { bestCardImage } from '../../shared/utils/card-image';
import { AppModalComponent } from '../../shared/ui/app-modal.component';
import { ClientCommanderValidationService } from './client-commander-validation.service';
import { DeckAnalysisService } from './deck-analysis.service';
import { DeckHistoryEntry, DeckHistoryStore } from './deck-history.store';
import { DeckImportExportService, DecklistEntry } from './deck-import-export.service';
import { MissingCardsStore } from './missing-cards.store';

type DeckEditorTab = 'analysis' | 'considering' | 'validation' | 'missing' | 'history';

interface MissingCardItem {
  name: string;
  quantity: number;
  section: DeckSection;
  watched: boolean;
}

interface MissingSearchResult {
  name: string;
  cards: Card[];
}

interface ImportStats {
  parsedCards: number;
  importedCards: number;
  missingCards: number;
}

interface DeckCardGroup {
  id: string;
  title: string;
  cards: DeckCard[];
}

interface DeckCardColumn {
  id: string;
  groups: DeckCardGroup[];
}

interface CardPreviewState {
  card: Card;
  imageUrl: string | null;
  top: number;
  left: number;
}

interface PointerPosition {
  x: number;
  y: number;
}

interface HoverListState {
  title: string;
  items: string[];
  top: number;
  left: number;
}

interface CardMenuState {
  entryId: string;
  top: number;
  left: number;
  amount: number;
}

const GROUPS: Array<{ id: string; title: string; matcher: (entry: DeckCard) => boolean }> = [
  { id: 'commander', title: 'Comandante', matcher: (entry) => entry.section === 'commander' },
  { id: 'planeswalker', title: 'Planeswalkers', matcher: (entry) => hasType(entry, 'planeswalker') },
  { id: 'creature', title: 'Criaturas', matcher: (entry) => hasType(entry, 'creature') },
  { id: 'instant', title: 'Instantaneos', matcher: (entry) => hasType(entry, 'instant') },
  { id: 'sorcery', title: 'Conjuros', matcher: (entry) => hasType(entry, 'sorcery') },
  { id: 'enchantment', title: 'Encantamientos', matcher: (entry) => hasType(entry, 'enchantment') },
  { id: 'artifact', title: 'Artefactos', matcher: (entry) => hasType(entry, 'artifact') },
  { id: 'sideboard', title: 'Banquillo', matcher: (entry) => entry.section === 'sideboard' },
  { id: 'land', title: 'Tierras', matcher: (entry) => hasType(entry, 'land') },
  { id: 'battle', title: 'Battles', matcher: (entry) => hasType(entry, 'battle') },
];

@Component({
  selector: 'app-deck-editor',
  imports: [FormsModule, RouterLink, LucideAngularModule, AppModalComponent, ManaSymbolsComponent],
  template: `
    <section class="page-stack">
      <a class="text-button" routerLink="/decks">
        <lucide-icon name="arrow-left" size="16" />
        Back to decks
      </a>

      @if (loading()) {
        <p class="notice">Loading deck...</p>
      } @else if (error()) {
        <p class="notice error">{{ error() }}</p>
      } @else if (deck(); as deck) {
        <div class="tool-header">
          <div>
            <span class="eyebrow">Deck editor</span>
            <h2>{{ deck.name }}</h2>
          </div>
          <div class="deck-editor-header-actions">
            <div class="deck-search-stack">
              <div class="deck-add-search">
                <lucide-icon name="search" size="16" />
                <input
                  name="deckCardSearch"
                  placeholder="Add cards by name"
                  [(ngModel)]="cardSearchQuery"
                  (ngModelChange)="onCardSearchQueryChange($event)"
                />
              </div>

              @if (cardSearchLoading()) {
                <section class="panel card-search-panel">
                  <p class="notice compact-notice">Searching cards...</p>
                </section>
              } @else if (cardSearchResults().length > 0) {
                <section class="panel card-search-panel">
                  <div class="dense-list compact-list autocomplete-list">
                    @for (card of cardSearchResults(); track card.scryfallId) {
                      <div class="autocomplete-item card-search-result">
                        <span>
                          <strong>{{ card.name }}</strong>
                          <small>{{ card.typeLine || 'Unknown type' }}</small>
                        </span>
                        <div class="button-row card-search-actions">
                          <small><app-mana-symbols [value]="card.manaCost" fallback="No cost" /></small>
                          <input
                            class="quantity-input"
                            type="number"
                            min="1"
                            [ngModel]="searchQuantityFor(card.scryfallId)"
                            (ngModelChange)="setSearchQuantity(card.scryfallId, $event)"
                          />
                          <button class="primary-button compact" type="button" (click)="addSearchedCard(card)">
                            <lucide-icon name="plus" size="15" />
                            Add
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                </section>
              }
            </div>
            <button class="primary-button compact" type="button" (click)="openImportModal()">
              <lucide-icon name="upload" size="16" />
              Import
            </button>
          </div>
        </div>

        <section class="panel deck-catalog-panel">
          <div class="deck-summary">
            <strong>{{ totalCards() }} cards</strong>
            <span>{{ cardGroups().length }} sections</span>
          </div>

          <div class="deck-card-groups">
            @for (column of cardColumns(); track column.id) {
              <div class="deck-card-column">
                @for (group of column.groups; track group.id) {
                  <section class="deck-card-group">
                    <button class="deck-group-toggle" type="button" [attr.aria-expanded]="!isGroupCollapsed(group.id)" (click)="toggleGroup(group.id)">
                      <span>
                        {{ group.title }} <span class="group-count">({{ group.cards.length }})</span>
                      </span>
                      <lucide-icon [name]="isGroupCollapsed(group.id) ? 'chevron-right' : 'chevron-down'" size="16" />
                    </button>
                    <div class="deck-group-body" [class.collapsed]="isGroupCollapsed(group.id)">
                      <div class="deck-group-body-inner">
                        <div class="deck-card-list">
                          @if (group.id === 'commander' && group.cards.length === 0) {
                            <p class="notice warning compact-notice">No commander assigned yet.</p>
                          } @else {
                            @for (entry of group.cards; track entry.id) {
                              <div
                                class="deck-card-row"
                                (mouseenter)="showCardPreview($event, entry.card)"
                                (mousemove)="moveCardPreview($event)"
                                (mouseleave)="hideCardPreview()"
                                (click)="toggleCardMenu($event, entry)"
                              >
                                <span class="deck-card-primary">
                                  <strong class="deck-card-name">
                                    {{ entry.quantity }} - {{ displayCardName(entry.card) }}
                                    @if (hasAlternateFace(entry.card)) {
                                      <button class="face-toggle-button" type="button" (click)="toggleCardFace($event, entry.card)">
                                        <lucide-icon name="rotate-cw" size="13" />
                                      </button>
                                    }
                                    @if (isCardInvalidForDeck(entry.card)) {
                                      <lucide-icon class="warning-mark" name="triangle-alert" size="14" [attr.title]="invalidCardMessage(entry.card)" />
                                    }
                                  </strong>
                                </span>
                                <small class="deck-card-secondary">{{ displayCardTypeLine(entry.card) || 'Unknown type' }}</small>
                                <span class="deck-card-cost">
                                  @if (shouldShowManaCost(entry.card)) {
                                    <app-mana-symbols [value]="entry.card.manaCost" fallback="-" />
                                  }
                                </span>
                              </div>
                              @if (cardMenu()?.entryId === entry.id) {
                                <div class="card-row-menu" [style.top.px]="cardMenu()!.top" [style.left.px]="cardMenu()!.left" (click)="$event.stopPropagation()">
                                  <label class="card-menu-amount">
                                    Quantity
                                    <input
                                      type="number"
                                      min="1"
                                      [ngModel]="cardMenu()?.amount ?? 1"
                                      (ngModelChange)="setCardMenuAmount($event)"
                                      (click)="$event.stopPropagation()"
                                    />
                                  </label>
                                  <button type="button" (click)="addCardCopy($event, entry)">Add copy</button>
                                  <button type="button" (click)="removeCardCopy($event, entry)">Remove copy</button>
                                  @if (entry.section !== 'main') {
                                    <button type="button" (click)="moveCardToSection($event, entry, 'main')">Move to main</button>
                                  }
                                  @if (entry.section !== 'commander') {
                                    <button type="button" (click)="moveCardToSection($event, entry, 'commander')">Move to commander</button>
                                  }
                                  @if (entry.section !== 'sideboard') {
                                    <button type="button" (click)="moveCardToSection($event, entry, 'sideboard')">Move to sideboard</button>
                                  }
                                  @if (entry.section !== 'maybeboard') {
                                    <button type="button" (click)="moveCardToSection($event, entry, 'maybeboard')">Move to considering</button>
                                  }
                                </div>
                              }
                            }
                          }
                        </div>
                      </div>
                    </div>
                  </section>
                }
              </div>
            }
          </div>
        </section>

        <section class="panel">
          <div class="deck-tabs" role="tablist" aria-label="Deck editor sections">
            <button type="button" [class.active]="activeTab() === 'analysis'" (click)="activeTab.set('analysis')">
              <lucide-icon name="bar-chart-3" size="16" />
              Analysis
            </button>
            <button type="button" [class.active]="activeTab() === 'considering'" (click)="activeTab.set('considering')">
              <lucide-icon name="library-big" size="16" />
              Considering
            </button>
            <button type="button" [class.active]="activeTab() === 'validation'" (click)="activeTab.set('validation')">
              <lucide-icon name="shield-check" size="16" />
              Validation
            </button>
            <button type="button" [class.active]="activeTab() === 'missing'" (click)="activeTab.set('missing')">
              <lucide-icon name="search-x" size="16" />
              Missing
            </button>
            <button type="button" [class.active]="activeTab() === 'history'" (click)="activeTab.set('history')">
              <lucide-icon name="history" size="16" />
              History
            </button>
          </div>

          @if (activeTab() === 'analysis') {
            <div class="analysis-shell analysis-screen">
              <section class="analysis-panel analysis-curve-panel">
                <div class="analysis-panel-header">
                  <div>
                    <h3>Mana curve</h3>
                    <p>Main deck by mana value.</p>
                  </div>
                  <div class="analysis-legend">
                    <span><i class="legend-dot permanent-dot"></i> Permanents</span>
                    <span><i class="legend-dot spell-dot"></i> Spells</span>
                  </div>
                </div>

                <div class="curve-grid compact-curve analysis-curve-large">
                  @for (bucket of analysis().manaCurve; track bucket.manaValue) {
                    <div class="curve-bar stacked-bar">
                      <span>{{ bucket.manaValue === 7 ? '7+' : bucket.manaValue }}</span>
                      <div class="curve-stack">
                        <strong
                          class="curve-segment permanent-segment"
                          [style.height.%]="curveSegmentHeight(bucket.permanents)"
                          (mouseenter)="showHoverList($event, curveHoverTitle(bucket.manaValue, 'Permanents'), curveHoverItems(bucket.manaValue, 'permanent'))"
                          (mousemove)="moveHoverList($event)"
                          (mouseleave)="hideHoverList()"
                        ></strong>
                        <strong
                          class="curve-segment spell-segment"
                          [style.height.%]="curveSegmentHeight(bucket.spells)"
                          (mouseenter)="showHoverList($event, curveHoverTitle(bucket.manaValue, 'Spells'), curveHoverItems(bucket.manaValue, 'spell'))"
                          (mousemove)="moveHoverList($event)"
                          (mouseleave)="hideHoverList()"
                        ></strong>
                      </div>
                      <small>{{ bucket.total }}</small>
                    </div>
                  }
                </div>

                <p class="analysis-footnote">Coste medio sin tierras: {{ analysis().averageManaValue }}</p>
              </section>

              <div class="analysis-side-column">
                <section class="analysis-panel">
                  <h3>Type breakdown</h3>
                  <div class="analysis-list-grid">
                    @for (metric of visibleTypeMetrics(); track metric.label) {
                      <div
                        class="analysis-list-row hoverable-analysis-row"
                        (mouseenter)="showHoverList($event, metric.label, metric.cards)"
                        (mousemove)="moveHoverList($event)"
                        (mouseleave)="hideHoverList()"
                      >
                        <span class="analysis-list-label">{{ metric.label }}</span>
                        <strong class="analysis-list-count">{{ metric.count }}</strong>
                      </div>
                    }
                  </div>
                </section>

                <section class="analysis-panel">
                  <h3>Utility counts</h3>
                  <div class="analysis-list-grid">
                    @for (metric of visibleUtilityMetrics(); track metric.label) {
                      <div
                        class="analysis-list-row hoverable-analysis-row"
                        (mouseenter)="showHoverList($event, metric.label, metric.cards)"
                        (mousemove)="moveHoverList($event)"
                        (mouseleave)="hideHoverList()"
                      >
                        <span class="analysis-list-label">{{ metric.label }}</span>
                        <strong class="analysis-list-count">{{ metric.count }}</strong>
                      </div>
                    }
                  </div>
                </section>
              </div>
            </div>

            <div class="analysis-support-grid">
              <section class="analysis-panel compact-analysis-panel mana-balance-panel">
                <div class="analysis-panel-header compact-analysis-header">
                  <div>
                    <h3>Mana balance</h3>
                    <p>Colored source share versus color demand.</p>
                  </div>
                  @if (manaSourceProfiles().length > 0) {
                    <div class="mana-donut-stack">
                      <div class="mana-donut" [style.background]="manaSourceDonutBackground()">
                        <span>{{ manaSourceTotal() }}</span>
                      </div>
                      <small>Total sources</small>
                    </div>
                  }
                </div>
                <div class="mana-balance-grid">
                  @for (profile of manaSourceProfiles(); track profile.color) {
                    <div class="mana-balance-row">
                      <div class="mana-balance-label">
                        <app-mana-symbols [symbols]="[profile.color]" />
                        <strong>{{ profile.label }}</strong>
                      </div>
                      <div class="mana-balance-metrics">
                        <span>{{ profile.sourceCount }} sources</span>
                        <strong>{{ profile.sourcePercent }}%</strong>
                      </div>
                      <div class="mana-balance-bars">
                        <div class="mana-balance-bar source-bar">
                          <span [style.width.%]="profile.sourcePercent"></span>
                        </div>
                        <div class="mana-balance-bar demand-bar">
                          <span [style.width.%]="profile.demandPercent"></span>
                        </div>
                      </div>
                      <div class="mana-balance-notes">
                        <small>Need {{ profile.demandCount }} pips</small>
                        <small>{{ profile.demandPercent }}% demand</small>
                      </div>
                    </div>
                  }
                </div>
              </section>
            </div>
          } @else if (activeTab() === 'considering') {
            <div class="analysis-shell analysis-screen considering-layout">
              <section class="analysis-panel">
                <div class="analysis-panel-header">
                  <div>
                    <h3>Considering cards</h3>
                    <p>Cards parked outside the playable deck.</p>
                  </div>
                  <strong class="analysis-list-count">{{ consideringCards().length }}</strong>
                </div>

                <div class="deck-card-list">
                  @for (entry of consideringCards(); track entry.id) {
                    <div
                      class="deck-card-row"
                      (mouseenter)="showCardPreview($event, entry.card)"
                      (mousemove)="moveCardPreview($event)"
                      (mouseleave)="hideCardPreview()"
                      (click)="toggleCardMenu($event, entry)"
                    >
                      <span class="deck-card-primary">
                        <strong class="deck-card-name">
                          {{ entry.quantity }} - {{ displayCardName(entry.card) }}
                          @if (hasAlternateFace(entry.card)) {
                            <button class="face-toggle-button" type="button" (click)="toggleCardFace($event, entry.card)">
                              <lucide-icon name="rotate-cw" size="13" />
                            </button>
                          }
                          @if (isCardInvalidForDeck(entry.card)) {
                            <lucide-icon class="warning-mark" name="triangle-alert" size="14" [attr.title]="invalidCardMessage(entry.card)" />
                          }
                        </strong>
                      </span>
                      <small class="deck-card-secondary">{{ displayCardTypeLine(entry.card) || 'Unknown type' }}</small>
                      <span class="deck-card-cost">
                        @if (shouldShowManaCost(entry.card)) {
                          <app-mana-symbols [value]="entry.card.manaCost" fallback="-" />
                        }
                      </span>
                    </div>
                    @if (cardMenu()?.entryId === entry.id) {
                      <div class="card-row-menu" [style.top.px]="cardMenu()!.top" [style.left.px]="cardMenu()!.left" (click)="$event.stopPropagation()">
                        <label class="card-menu-amount">
                          Quantity
                          <input
                            type="number"
                            min="1"
                            [ngModel]="cardMenu()?.amount ?? 1"
                            (ngModelChange)="setCardMenuAmount($event)"
                            (click)="$event.stopPropagation()"
                          />
                        </label>
                        <button type="button" (click)="addCardCopy($event, entry)">Add copy</button>
                        <button type="button" (click)="removeCardCopy($event, entry)">Remove copy</button>
                        <button type="button" (click)="moveCardToSection($event, entry, 'main')">Move to main</button>
                        <button type="button" (click)="moveCardToSection($event, entry, 'commander')">Move to commander</button>
                        <button type="button" (click)="moveCardToSection($event, entry, 'sideboard')">Move to sideboard</button>
                      </div>
                    }
                  } @empty {
                    <p class="notice compact-notice">No considering cards.</p>
                  }
                </div>
              </section>

              <div class="analysis-side-column">
                <section class="analysis-panel">
                  <div class="analysis-panel-header">
                    <div>
                      <h3>Derived tokens</h3>
                      <p>Resolved from cards currently in the deck.</p>
                    </div>
                    <strong class="analysis-list-count">{{ tokens().length }}</strong>
                  </div>

                  <div class="dense-list compact-list">
                    @for (entry of tokens(); track entry.sourceCard.scryfallId + entry.token.scryfallId) {
                      <div
                        class="deck-card-row"
                        (mouseenter)="showCardPreview($event, entry.token)"
                        (mousemove)="moveCardPreview($event)"
                        (mouseleave)="hideCardPreview()"
                      >
                        <span class="deck-card-primary">
                          <strong class="deck-card-name">{{ entry.token.name }}</strong>
                        </span>
                        <small class="deck-card-secondary">From {{ entry.sourceCard.name }}</small>
                        <span class="deck-card-cost">
                          @if (shouldShowManaCost(entry.token)) {
                            <app-mana-symbols [value]="entry.token.manaCost" fallback="-" />
                          }
                        </span>
                      </div>
                    } @empty {
                      <p class="notice compact-notice">No resolved tokens for this deck.</p>
                    }
                  </div>

                  @if (unresolvedTokens().length > 0) {
                    <div class="notice warning compact-notice">
                      <strong>Unresolved tokens</strong>
                      <span>{{ unresolvedTokens().map((item) => item.token.name).join(', ') }}</span>
                    </div>
                  }
                </section>
              </div>
            </div>
          } @else if (activeTab() === 'validation') {
            <div class="button-row wrap-row">
              <button class="primary-button" type="button" (click)="validate(deck.id)">
                <lucide-icon name="check-circle-2" size="17" />
                Validate with backend
              </button>
            </div>

            @if (validation(); as result) {
              <div class="notice" [class.ok-notice]="result.valid" [class.error]="!result.valid">
                <strong>{{ result.valid ? 'Commander legal by backend' : 'Backend Commander issues' }}</strong>
                @if (!result.valid) {
                  <ul>
                    @for (message of result.errors; track message) {
                      <li>{{ message }}</li>
                    }
                  </ul>
                }
              </div>
            }

            <div class="dense-list">
              @for (issue of clientIssues(); track issue.title + issue.detail) {
                <div class="list-row issue-row" [class.error-issue]="issue.severity === 'error'">
                  <span>
                    <strong>{{ issue.title }}</strong>
                    <small>{{ issue.detail }}</small>
                  </span>
                  <span class="metric">{{ issue.severity }}</span>
                </div>
              } @empty {
                <p class="notice ok-notice">No frontend diagnostics for the current deck.</p>
              }
            </div>
          } @else if (activeTab() === 'missing') {
            @if (missingItems().length > 0) {
              <div class="dense-list">
                @for (item of missingItems(); track item.name) {
                  <div class="missing-row">
                    <span>
                      <strong>{{ item.quantity }} {{ item.name }}</strong>
                      <small>{{ item.section }}{{ item.watched ? ' - saved' : '' }}</small>
                    </span>
                    <div class="button-row">
                      <button class="icon-button" type="button" title="Copy card name" (click)="copyMissing(item.name)">
                        <lucide-icon name="copy" size="15" />
                      </button>
                      <button class="icon-button" type="button" title="Search card" (click)="searchMissing(item.name)">
                        <lucide-icon name="search" size="15" />
                      </button>
                      <button class="icon-button" type="button" title="Save missing card" (click)="saveMissing(item.name, deck.id)">
                        <lucide-icon name="bookmark-plus" size="15" />
                      </button>
                      <button class="icon-button" type="button" title="Ignore this session" (click)="ignoreMissing(item.name)">
                        <lucide-icon name="eye-off" size="15" />
                      </button>
                    </div>
                  </div>
                }
              </div>
            } @else {
              <p class="notice ok-notice">No unresolved cards from the latest import.</p>
            }

            @if (missingSearch(); as search) {
              <h3>Search results for {{ search.name }}</h3>
              <div class="search-bar compact-search">
                <lucide-icon name="search" size="18" />
                <input name="missingSearchQuery" placeholder="Search another card name" [(ngModel)]="missingSearchQuery" />
                <button class="primary-button compact" type="button" (click)="searchMissingQuery()">Search</button>
              </div>
              <div class="dense-list">
                @for (card of search.cards; track card.scryfallId) {
                  <div class="list-row">
                    <span>
                      <strong>
                        {{ card.name }}
                        @if (isCardInvalidForDeck(card)) {
                          <lucide-icon class="warning-mark" name="triangle-alert" size="14" [attr.title]="invalidCardMessage(card)" />
                        }
                      </strong>
                      <small><app-mana-symbols [value]="card.manaCost" fallback="No cost" /></small>
                      <small>{{ card.typeLine || 'Unknown type' }}</small>
                    </span>
                    <div class="button-row">
                      <a class="text-button compact" [routerLink]="['/cards', card.scryfallId]">View</a>
                      <button class="primary-button compact" type="button" (click)="addMissingCard(search.name, card)">
                        <lucide-icon name="plus" size="15" />
                        Add
                      </button>
                    </div>
                  </div>
                } @empty {
                  <p class="notice warning">No card search results.</p>
                }
              </div>
            }

            @if (missingStore.watchlist().length > 0) {
              <h3>Future collection</h3>
              <div class="dense-list">
                @for (item of missingStore.watchlist(); track item.name) {
                  <div class="list-row">
                    <span>
                      <strong>{{ item.name }}</strong>
                      <small>{{ formatDate(item.addedAt) }}</small>
                    </span>
                    <button class="icon-button" type="button" title="Remove" (click)="missingStore.remove(item.name)">
                      <lucide-icon name="x" size="15" />
                    </button>
                  </div>
                }
              </div>
            }
          } @else {
            <div class="button-row wrap-row">
              <button class="secondary-button" type="button" (click)="recordHistory(deck, 'Manual snapshot')">
                <lucide-icon name="camera" size="17" />
                Snapshot
              </button>
              <button class="icon-button danger" type="button" title="Clear local history" (click)="clearHistoryModalOpen.set(true)">
                <lucide-icon name="trash" size="16" />
              </button>
            </div>

            <div class="dense-list">
              @for (entry of history(); track entry.id) {
                <div class="history-row">
                  <span>
                    <strong>{{ entry.source }}</strong>
                    <small>{{ formatDate(entry.createdAt) }} - {{ entry.totalCards }} cards - {{ entry.commanders.join(', ') || 'No commander' }}</small>
                    <small>+{{ entry.diff.added.length }} / -{{ entry.diff.removed.length }} / +/-{{ entry.diff.changed.length }}</small>
                  </span>
                  <button class="secondary-button compact" type="button" (click)="restoreHistory(entry)">
                    <lucide-icon name="rotate-ccw" size="15" />
                    Restore
                  </button>
                </div>
              } @empty {
                <p class="notice">No local history for this deck yet.</p>
              }
            </div>
          }
        </section>

        @if (cardPreview(); as preview) {
          <div class="card-hover-preview" [style.top.px]="preview.top" [style.left.px]="preview.left">
            @if (preview.imageUrl) {
              <img [src]="preview.imageUrl" [alt]="preview.card.name" />
            } @else {
              <div class="card-fallback tall">{{ preview.card.name }}</div>
            }
          </div>
        }

        @if (hoverList(); as hover) {
          <div class="analysis-hover-list" [style.top.px]="hover.top" [style.left.px]="hover.left">
            <strong>{{ hover.title }}</strong>
            @if (hover.items.length > 0) {
              <ul>
                @for (item of hover.items; track item) {
                  <li>{{ item }}</li>
                }
              </ul>
            } @else {
              <span>No cards</span>
            }
          </div>
        }

        <app-modal
          [open]="importModalOpen()"
          title="Import decklist"
          primaryLabel="Import"
          secondaryLabel="Cancel"
          (primary)="importDeck(deck.id)"
          (secondary)="closeImportModal()"
        >
          <div class="form-stack">
            <label>
              Deck name
              <input name="deckName" [(ngModel)]="deckName" />
            </label>
            <button class="secondary-button compact" type="button" (click)="rename(deck.id)">
              <lucide-icon name="save" size="16" />
              Save name
            </button>
            <label>
              Plain text decklist
              <textarea name="decklist" rows="14" placeholder="1 Sol Ring (VOC) 168&#10;1 Fable of the Mirror-Breaker / Reflection of Kiki-Jiki (NEO) 141" [(ngModel)]="decklist"></textarea>
            </label>
            <button class="secondary-button compact" type="button" (click)="fileInput.click()">
              <lucide-icon name="file-up" size="16" />
              Load file
            </button>
            <input #fileInput class="hidden-input" type="file" accept=".txt,.csv,.dek" (change)="loadDeckFile($event)" />

            @if (lastImportStats(); as stats) {
              <div class="notice" [class.warning]="stats.missingCards > 0" [class.ok-notice]="stats.missingCards === 0">
                <strong>Last import</strong>
                <span>{{ stats.parsedCards }} parsed cards, {{ stats.importedCards }} imported, {{ stats.missingCards }} missing.</span>
              </div>
            }

            @if (missingItems().length > 0) {
              <div class="notice warning">
                <strong>Missing cards from latest import</strong>
                <span>{{ missingPreview() }}</span>
              </div>
            }
          </div>
        </app-modal>

        <app-modal
          [open]="restoreModalOpen()"
          title="Restore history"
          [message]="restoreTarget() ? 'Restore this snapshot?' : ''"
          primaryLabel="Restore"
          secondaryLabel="Cancel"
          (primary)="confirmRestoreHistory(deck.id)"
          (secondary)="restoreModalOpen.set(false)"
        />

        <app-modal
          [open]="clearHistoryModalOpen()"
          title="Clear local history"
          message="Clear local history for this deck?"
          primaryLabel="Clear"
          secondaryLabel="Cancel"
          [danger]="true"
          (primary)="confirmClearHistory(deck.id)"
          (secondary)="clearHistoryModalOpen.set(false)"
        />
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckEditorComponent implements OnDestroy {
  private readonly decksApi = inject(DecksApi);
  private readonly cardsApi = inject(CardsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly importExport = inject(DeckImportExportService);
  private readonly analysisService = inject(DeckAnalysisService);
  private readonly clientValidation = inject(ClientCommanderValidationService);
  private readonly historyStore = inject(DeckHistoryStore);
  readonly missingStore = inject(MissingCardsStore);

  readonly deck = signal<Deck | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly missing = signal<string[]>([]);
  readonly missingSourceEntries = signal<MissingDeckCard[]>([]);
  readonly missingSearch = signal<MissingSearchResult | null>(null);
  readonly missingAddTarget = signal<string | null>(null);
  readonly tokens = signal<DeckToken[]>([]);
  readonly unresolvedTokens = signal<UnresolvedDeckToken[]>([]);
  readonly lastImportStats = signal<ImportStats | null>(null);
  readonly validation = signal<CommanderValidation | null>(null);
  readonly activeTab = signal<DeckEditorTab>('analysis');
  readonly importModalOpen = signal(false);
  readonly restoreModalOpen = signal(false);
  readonly clearHistoryModalOpen = signal(false);
  readonly restoreTarget = signal<DeckHistoryEntry | null>(null);
  readonly history = signal<DeckHistoryEntry[]>([]);
  readonly cardPreview = signal<CardPreviewState | null>(null);
  readonly hoverList = signal<HoverListState | null>(null);
  readonly cardMenu = signal<CardMenuState | null>(null);
  readonly cardSearchResults = signal<Card[]>([]);
  readonly cardSearchLoading = signal(false);
  readonly searchQuantities = signal<Record<string, number>>({});
  readonly collapsedGroups = signal<Set<string>>(new Set());
  readonly flippedFaces = signal<Record<string, boolean>>({});
  readonly mainCards = computed(() => this.cardsBySection('main'));
  readonly commanderCards = computed(() => this.cardsBySection('commander'));
  readonly sideboardCards = computed(() => this.cardsBySection('sideboard'));
  readonly consideringCards = computed(() => this.cardsBySection('maybeboard'));
  readonly totalCards = computed(() => (this.deck()?.cards ?? [])
    .filter((entry) => entry.section !== 'maybeboard')
    .reduce((total, entry) => total + entry.quantity, 0));
  readonly analysis = computed(() => this.analysisService.analyze(this.deck()));
  readonly clientIssues = computed(() => this.clientValidation.validate(this.deck()));
  readonly typeMetrics = computed(() => {
    const analysis = this.analysis();

    return [
      analysis.lands,
      analysis.planeswalkers,
      analysis.creatures,
      analysis.instants,
      analysis.sorceries,
      analysis.enchantments,
      analysis.artifacts,
    ];
  });
  readonly utilityMetrics = computed(() => {
    const analysis = this.analysis();

    return [analysis.ramp, analysis.draw, analysis.removal, analysis.wipes];
  });
  readonly visibleTypeMetrics = computed(() => this.typeMetrics().filter((metric) => metric.count > 0));
  readonly visibleUtilityMetrics = computed(() => this.utilityMetrics().filter((metric) => metric.count > 0));
  readonly manaSourceProfiles = computed(() => this.buildManaSourceProfiles());
  readonly manaSourceTotal = computed(() => this.manaSourceProfiles().reduce((sum, profile) => sum + profile.sourceCount, 0));
  readonly manaSourceDonutBackground = computed(() => this.buildManaSourceDonutBackground());
  readonly missingItems = computed(() => this.buildMissingItems());
  readonly cardGroups = computed(() => this.buildCardGroups());
  readonly cardColumns = computed(() => this.buildCardColumns());

  deckName = '';
  decklist = '';
  missingSearchQuery = '';
  cardSearchQuery = '';
  private readonly previewCache = new Map<string, string>();
  private readonly previewRequests = new Map<string, Promise<string | null>>();
  private previewEnterTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastPreviewPointer: PointerPosition | null = null;
  private cardSearchTimeout: ReturnType<typeof setTimeout> | null = null;
  private cardSearchVersion = 0;
  private lastCardSearchQuery = '';
  private lastCardSearchResultsSignature = '';

  constructor() {
    void this.load();
  }

  @HostListener('document:click')
  handleDocumentClick(): void {
    this.cardMenu.set(null);
  }

  ngOnDestroy(): void {
    if (this.previewEnterTimeout) {
      clearTimeout(this.previewEnterTimeout);
    }
    if (this.cardSearchTimeout) {
      clearTimeout(this.cardSearchTimeout);
    }
    this.previewCache.clear();
    this.previewRequests.clear();
  }

  async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('Missing deck id.');
      this.loading.set(false);
      return;
    }

    try {
      const [response, tokensResponse] = await Promise.all([
        firstValueFrom(this.decksApi.get(id)),
        firstValueFrom(this.decksApi.tokens(id)),
      ]);
      this.deck.set(response.deck);
      this.deckName = response.deck.name;
      this.tokens.set(tokensResponse.data);
      this.unresolvedTokens.set(tokensResponse.unresolved);
      this.missing.set([]);
      this.missingSourceEntries.set([]);
      this.refreshHistory(response.deck.id);
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not load deck.'));
    } finally {
      this.loading.set(false);
    }
  }

  async rename(id: string): Promise<void> {
    try {
      const response = await firstValueFrom(this.decksApi.rename(id, this.deckName.trim()));
      this.deck.set(response.deck);
      this.deckName = response.deck.name;
      this.recordHistory(response.deck, 'Rename');
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not rename deck.'));
    }
  }

  async importDeck(id: string): Promise<void> {
    try {
      const entries = this.importExport.parse(this.decklist, 'plain');
      const response = await firstValueFrom(this.decksApi.importDecklist(id, this.importExport.toBackendDecklist(entries)));
      this.deck.set(response.deck);
      this.missing.set(response.missing);
      this.missingSourceEntries.set(response.missingCards ?? []);
      this.lastImportStats.set({
        parsedCards: response.summary?.parsedCards ?? entries.reduce((total, entry) => total + entry.quantity, 0),
        importedCards: response.summary?.importedCards ?? (response.deck.cards ?? []).reduce((total, entry) => total + entry.quantity, 0),
        missingCards: response.missing.length,
      });
      this.validation.set(null);
      this.missingSearch.set(null);
      this.recordHistory(response.deck, 'Import plain text');
      void this.refreshTokens(response.deck.id);
      if (response.missing.length > 0) {
        this.activeTab.set('missing');
      } else {
        this.importModalOpen.set(false);
      }
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not import deck.'));
    }
  }

  async validate(id: string): Promise<void> {
    try {
      const response = await firstValueFrom(this.decksApi.validateCommander(id));
      this.validation.set(response);
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not validate deck.'));
    }
  }

  loadDeckFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      this.decklist = String(reader.result ?? '');
      input.value = '';
    };
    reader.readAsText(file);
  }

  openImportModal(): void {
    this.importModalOpen.set(true);
  }

  closeImportModal(): void {
    this.importModalOpen.set(false);
  }

  onCardSearchQueryChange(value: string): void {
    const sanitized = sanitizeDeckSearchQuery(value);
    this.cardSearchQuery = sanitized;
    if (this.cardSearchTimeout) {
      clearTimeout(this.cardSearchTimeout);
    }

    const query = sanitized.trim();
    if (query.length < 2) {
      this.cardSearchResults.set([]);
      this.cardSearchLoading.set(false);
      this.lastCardSearchQuery = '';
      this.lastCardSearchResultsSignature = '';
      this.searchQuantities.set({});
      return;
    }

    this.cardSearchLoading.set(true);
    const version = ++this.cardSearchVersion;
    this.cardSearchTimeout = setTimeout(() => {
      void this.searchCardsToAdd(query, version);
    }, 320);
  }

  toggleGroup(groupId: string): void {
    const next = new Set(this.collapsedGroups());
    if (next.has(groupId)) {
      next.delete(groupId);
    } else {
      next.add(groupId);
    }
    this.collapsedGroups.set(next);
  }

  isGroupCollapsed(groupId: string): boolean {
    return this.collapsedGroups().has(groupId);
  }

  curveSegmentHeight(count: number): number {
    const max = Math.max(...this.analysis().manaCurve.map((bucket) => bucket.total), 1);

    return Math.max((count / max) * 100, count > 0 ? 12 : 0);
  }

  curveHoverTitle(manaValue: number, label: string): string {
    return `${label} - MV ${manaValue === 7 ? '7+' : manaValue}`;
  }

  curveHoverItems(manaValue: number, kind: 'permanent' | 'spell'): string[] {
    const entries = (this.deck()?.cards ?? [])
      .filter((entry) => entry.section === 'main')
      .filter((entry) => Math.min(this.cardManaValue(entry.card), 7) === manaValue)
      .filter((entry) => kind === 'spell' ? this.isSpellEntry(entry) : !this.isSpellEntry(entry))
      .map((entry) => entry.card.name);

    return Array.from(new Set(entries)).sort((left, right) => left.localeCompare(right));
  }

  copyMissing(name: string): void {
    void navigator.clipboard?.writeText(name);
  }

  async searchMissing(name: string): Promise<void> {
    this.missingAddTarget.set(name);
    this.missingSearchQuery = name;
    await this.searchMissingQuery();
  }

  async searchMissingQuery(): Promise<void> {
    const query = this.missingSearchQuery.trim();
    if (!query) {
      return;
    }

    try {
      const response = await firstValueFrom(this.cardsApi.search(query, 1, 8));
      this.missingSearch.set({ name: query, cards: response.data });
    } catch (error) {
      void error;
      this.missingSearch.set({ name: query, cards: [] });
    }
  }

  saveMissing(name: string, deckId: string): void {
    this.missingStore.add(name, deckId);
  }

  async addMissingCard(missingName: string, card: Card): Promise<void> {
    const currentDeck = this.deck();
    if (!currentDeck) {
      return;
    }

    const targetName = this.missingAddTarget() ?? missingName;
    const sourceEntries = this.missingSourceEntries().filter((entry) => entry.name.toLowerCase() === targetName.toLowerCase());
    const quantity = sourceEntries.reduce((total, entry) => total + entry.quantity, 0) || 1;
    const section = (sourceEntries.find((entry) => entry.section === 'commander')?.section
      ?? sourceEntries.find((entry) => entry.section === 'sideboard')?.section
      ?? sourceEntries.find((entry) => entry.section === 'maybeboard')?.section
      ?? sourceEntries[0]?.section
      ?? 'main') as DeckSection;
    try {
      const response = await firstValueFrom(this.decksApi.addCard(currentDeck.id, {
        scryfallId: card.scryfallId,
        quantity,
        section,
      }));
      this.deck.set(response.deck);
      this.missing.set(this.missing().filter((name) => name !== targetName));
      this.missingSourceEntries.set(this.missingSourceEntries().filter((entry) => entry.name.toLowerCase() !== targetName.toLowerCase()));
      this.validation.set(null);
      this.recordHistory(response.deck, `Manual add ${card.name}`);
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not add selected card.'));
    }
  }

  missingPreview(): string {
    const items = this.missingItems();
    const preview = items.slice(0, 6).map((item) => `${item.quantity} ${item.name}`).join(', ');

    return items.length > 6 ? `${preview}...` : preview;
  }

  ignoreMissing(name: string): void {
    this.missingStore.ignoreForSession(name);
    this.missing.set([...this.missing()]);
  }

  recordHistory(deck: Deck, source: string): void {
    this.historyStore.record(deck, source);
    this.refreshHistory(deck.id);
  }

  restoreHistory(entry: DeckHistoryEntry): void {
    this.restoreTarget.set(entry);
    this.restoreModalOpen.set(true);
  }

  async confirmRestoreHistory(deckId: string): Promise<void> {
    const entry = this.restoreTarget();
    const current = this.deck();
    if (!current || !entry) {
      return;
    }

    try {
      this.historyStore.record(current, 'Before restore');
      const response = await firstValueFrom(this.decksApi.importDecklist(deckId, entry.decklist));
      this.deck.set(response.deck);
      this.deckName = response.deck.name;
      this.missing.set(response.missing);
      this.missingSourceEntries.set(response.missingCards ?? []);
      this.missingSearch.set(null);
      this.validation.set(null);
      this.refreshHistory(deckId);
      void this.refreshTokens(deckId);
      this.restoreModalOpen.set(false);
      this.restoreTarget.set(null);
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not restore history entry.'));
    }
  }

  confirmClearHistory(deckId: string): void {
    this.historyStore.clear(deckId);
    this.refreshHistory(deckId);
    this.clearHistoryModalOpen.set(false);
  }

  formatDate(value: string): string {
    return new Intl.DateTimeFormat('en', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  }

  isCommanderIllegal(entry: DeckCard): boolean {
    return this.isCardInvalidForDeck(entry.card);
  }

  isCardInvalidForDeck(card: Card): boolean {
    const format = this.deckFormatKey();
    const legality = (card.legalities?.[format] ?? '').toLowerCase();
    if (format === 'commander') {
      return !card.commanderLegal || ['banned', 'not_legal'].includes(legality);
    }

    return ['banned', 'not_legal'].includes(legality) || legality === '';
  }

  invalidCardMessage(card: Card): string {
    return `Esta carta no es valida en ${this.deckFormatLabel()}.`;
  }

  toggleCardMenu(event: MouseEvent, entry: DeckCard): void {
    event.stopPropagation();
    const current = this.cardMenu();
    if (current?.entryId === entry.id) {
      this.cardMenu.set(null);
      return;
    }

    this.cardMenu.set({
      entryId: entry.id,
      top: event.clientY + 10,
      left: Math.min(event.clientX + 10, window.innerWidth - 180),
      amount: 1,
    });
  }

  setCardMenuAmount(value: unknown): void {
    const current = this.cardMenu();
    if (!current) {
      return;
    }

    this.cardMenu.set({
      ...current,
      amount: this.normalizeQuantity(value),
    });
  }

  async addCardCopy(event: MouseEvent, entry: DeckCard): Promise<void> {
    event.stopPropagation();
    const currentDeck = this.deck();
    if (!currentDeck) {
      return;
    }
    const amount = this.cardMenuAmount();

    try {
      const response = entry.section === 'commander'
        ? await this.addCopiesToMain(currentDeck, entry.card, amount)
        : await firstValueFrom(this.decksApi.updateCard(currentDeck.id, entry.id, {
          quantity: entry.quantity + amount,
        }));
      this.applyDeckUpdate(response.deck, `Add copy ${entry.card.name}`);
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not add card copy.'));
    }
  }

  async removeCardCopy(event: MouseEvent, entry: DeckCard): Promise<void> {
    event.stopPropagation();
    const currentDeck = this.deck();
    if (!currentDeck) {
      return;
    }
    const amount = this.cardMenuAmount();

    try {
      const response = amount >= entry.quantity
        ? await firstValueFrom(this.decksApi.removeCard(currentDeck.id, entry.id))
        : await firstValueFrom(this.decksApi.updateCard(currentDeck.id, entry.id, {
          quantity: entry.quantity - amount,
        }));
      this.applyDeckUpdate(response.deck, `Remove copy ${entry.card.name}`);
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not remove card copy.'));
    }
  }

  async moveCardToSection(event: MouseEvent, entry: DeckCard, target: DeckSection): Promise<void> {
    event.stopPropagation();
    const currentDeck = this.deck();
    if (!currentDeck || entry.section === target) {
      this.cardMenu.set(null);
      return;
    }

    try {
      let deck: Deck;
      if (target === 'commander') {
        deck = await this.moveCardIntoCommander(currentDeck, entry);
      } else if (entry.section === 'commander') {
        deck = await this.moveCommanderOut(currentDeck, entry, target);
      } else {
        const response = await firstValueFrom(this.decksApi.updateCard(currentDeck.id, entry.id, { section: target }));
        deck = response.deck;
      }

      this.applyDeckUpdate(deck, `Move ${entry.card.name} to ${this.sectionLabel(target)}`);
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, `Could not move card to ${this.sectionLabel(target)}.`));
    }
  }

  showHoverList(event: MouseEvent, title: string, items: string[]): void {
    this.hoverList.set({
      title,
      items,
      top: Math.min(event.clientY + 16, window.innerHeight - 220),
      left: Math.min(event.clientX + 16, window.innerWidth - 280),
    });
  }

  moveHoverList(event: MouseEvent): void {
    const current = this.hoverList();
    if (!current) {
      return;
    }

    this.hoverList.set({
      ...current,
      top: Math.min(event.clientY + 16, window.innerHeight - 220),
      left: Math.min(event.clientX + 16, window.innerWidth - 280),
    });
  }

  hideHoverList(): void {
    this.hoverList.set(null);
  }

  shouldShowManaCost(card: Card): boolean {
    if (card.manaCost) {
      return true;
    }

    return !(card.typeLine?.toLowerCase().includes('land') ?? false);
  }

  showCardPreview(event: MouseEvent, card: Card): void {
    if (this.previewEnterTimeout) {
      clearTimeout(this.previewEnterTimeout);
    }

    this.lastPreviewPointer = { x: event.clientX, y: event.clientY };

    this.previewEnterTimeout = setTimeout(() => {
      const cached = this.previewCache.get(card.scryfallId) ?? bestCardImage(card);
      this.updatePreviewPosition(this.lastPreviewPointer ?? { x: event.clientX, y: event.clientY }, card, cached);
      void this.resolvePreviewImage(card);
    }, 120);
  }

  moveCardPreview(event: MouseEvent): void {
    this.lastPreviewPointer = { x: event.clientX, y: event.clientY };
    const preview = this.cardPreview();
    if (!preview) {
      return;
    }

    this.updatePreviewPosition(this.lastPreviewPointer, preview.card, preview.imageUrl);
  }

  hideCardPreview(): void {
    if (this.previewEnterTimeout) {
      clearTimeout(this.previewEnterTimeout);
      this.previewEnterTimeout = null;
    }
    this.lastPreviewPointer = null;
    this.cardPreview.set(null);
  }

  private updatePreviewPosition(pointer: PointerPosition, card: Card, imageUrl: string | null): void {
    const width = 280;
    const height = 390;
    const margin = 18;
    const left = pointer.x + width + margin < window.innerWidth ? pointer.x + margin : Math.max(12, pointer.x - width - margin);
    const top = Math.min(Math.max(12, pointer.y - 26), Math.max(12, window.innerHeight - height - 12));

    this.cardPreview.set({ card, imageUrl, top, left });
  }

  private async resolvePreviewImage(card: Card): Promise<void> {
    const cached = this.previewCache.get(card.scryfallId);
    if (cached) {
      return;
    }

    const existingRequest = this.previewRequests.get(card.scryfallId);
    const request = existingRequest ?? this.fetchPreviewImage(card);
    if (!existingRequest) {
      this.previewRequests.set(card.scryfallId, request);
    }

    const imageUrl = await request;
    this.previewRequests.delete(card.scryfallId);
    if (!imageUrl) {
      return;
    }

    this.previewCache.set(card.scryfallId, imageUrl);
    if (this.cardPreview()?.card.scryfallId === card.scryfallId && this.lastPreviewPointer) {
      this.updatePreviewPosition(this.lastPreviewPointer, card, imageUrl);
    }
  }

  private async fetchPreviewImage(card: Card): Promise<string | null> {
    try {
      const response = await firstValueFrom(this.cardsApi.image(card.scryfallId, 'normal'));
      return response.uri;
    } catch {
      return bestCardImage(card);
    }
  }

  private cardsBySection(section: DeckSection): DeckCard[] {
    return (this.deck()?.cards ?? []).filter((entry) => entry.section === section);
  }

  private async searchCardsToAdd(query: string, version: number): Promise<void> {
    try {
      const response = await firstValueFrom(this.cardsApi.search(query, 1, 24));
      if (version === this.cardSearchVersion && query === this.cardSearchQuery.trim()) {
        const distinctCards = this.filterAndDistinctSearchCards(response.data, query);
        const signature = distinctCards.map((card) => this.cardSearchDistinctKey(card)).join('|');
        if (signature === this.lastCardSearchResultsSignature && query === this.lastCardSearchQuery) {
          return;
        }

        this.lastCardSearchQuery = query;
        this.lastCardSearchResultsSignature = signature;
        this.cardSearchResults.set(distinctCards);
      }
    } catch {
      if (version === this.cardSearchVersion) {
        this.cardSearchResults.set([]);
      }
    } finally {
      if (version === this.cardSearchVersion) {
        this.cardSearchLoading.set(false);
      }
    }
  }

  async addSearchedCard(card: Card): Promise<void> {
    const currentDeck = this.deck();
    if (!currentDeck) {
      return;
    }
    const amount = this.searchQuantityFor(card.scryfallId);

    try {
      const response = await this.addCopiesToMain(currentDeck, card, amount);
      this.applyDeckUpdate(response.deck, `Manual add ${card.name}`);
      this.cardSearchQuery = '';
      this.cardSearchResults.set([]);
      this.lastCardSearchQuery = '';
      this.lastCardSearchResultsSignature = '';
      this.searchQuantities.set({});
    } catch (error) {
      this.error.set(this.apiErrorMessage(error, 'Could not add selected card.'));
    }
  }

  private refreshHistory(deckId: string): void {
    this.history.set(this.historyStore.list(deckId));
  }

  searchQuantityFor(cardId: string): number {
    return this.searchQuantities()[cardId] ?? 1;
  }

  setSearchQuantity(cardId: string, value: unknown): void {
    this.searchQuantities.set({
      ...this.searchQuantities(),
      [cardId]: this.normalizeQuantity(value),
    });
  }

  private buildMissingItems(): MissingCardItem[] {
    const aggregated = new Map<string, MissingCardItem>();
    for (const source of this.missingSourceEntries()) {
      if (this.missingStore.isIgnored(source.name)) {
        continue;
      }

      const key = source.name.toLowerCase();
      const existing = aggregated.get(key);
      if (existing) {
        existing.quantity += source.quantity;
        if (source.section === 'commander' || source.section === 'sideboard' || source.section === 'maybeboard') {
          existing.section = source.section as DeckSection;
        }
        continue;
      }

      aggregated.set(key, {
        name: source.name,
        quantity: source.quantity,
        section: this.normalizeMissingSection(source.section),
        watched: this.missingStore.isWatched(source.name),
      });
    }

    if (aggregated.size > 0) {
      return Array.from(aggregated.values()).filter((item) => this.missing().includes(item.name));
    }

    return this.missing()
      .filter((name) => !this.missingStore.isIgnored(name))
      .map((name) => ({
        name,
        quantity: 1,
        section: 'main',
        watched: this.missingStore.isWatched(name),
      }));
  }

  private buildCardGroups(): DeckCardGroup[] {
    const cards = [...(this.deck()?.cards ?? [])]
      .filter((entry) => entry.section !== 'maybeboard')
      .sort((left, right) => left.card.name.localeCompare(right.card.name));
    const groups: DeckCardGroup[] = [];
    const assigned = new Set<string>();

    for (const group of GROUPS) {
      const items = cards.filter((entry) => !assigned.has(entry.id) && group.matcher(entry));
      if (items.length === 0 && group.id !== 'commander') {
        continue;
      }

      items.forEach((entry) => assigned.add(entry.id));
      groups.push({ id: group.id, title: group.title, cards: items });
    }

    const remaining = cards.filter((entry) => !assigned.has(entry.id));
    if (remaining.length > 0) {
      groups.push({ id: 'other', title: 'Otros', cards: remaining });
    }

    return groups;
  }

  private buildCardColumns(): DeckCardColumn[] {
    const groups = this.cardGroups();
    if (groups.length === 0) {
      return [];
    }

    const columns: DeckCardColumn[] = [];
    const targetCardsPerColumn = 18;
    let currentGroups: DeckCardGroup[] = [];
    let currentCount = 0;

    for (const group of groups) {
      const shouldStartNewColumn = currentGroups.length > 0
        && currentCount >= targetCardsPerColumn
        && group.cards.length > 4
        && group.id !== 'sideboard'
        && group.id !== 'land'
        && currentGroups[currentGroups.length - 1]?.id !== 'sideboard';

      if (shouldStartNewColumn) {
        columns.push({
          id: currentGroups.map((item) => item.id).join('-'),
          groups: currentGroups,
        });
        currentGroups = [];
        currentCount = 0;
      }

      currentGroups.push(group);
      currentCount += group.cards.length;
    }

    if (currentGroups.length > 0) {
      columns.push({
        id: currentGroups.map((item) => item.id).join('-'),
        groups: currentGroups,
      });
    }

    return columns;
  }

  private cardManaValue(card: Card): number {
    const cost = card.manaCost;
    if (!cost) {
      return 0;
    }

    return (cost.match(/\{[^}]+\}/g) ?? []).reduce((total, symbol) => {
      const value = symbol.slice(1, -1);
      const numeric = Number.parseInt(value, 10);

      if (Number.isFinite(numeric)) {
        return total + numeric;
      }

      return value === 'X' ? total : total + 1;
    }, 0);
  }

  private applyDeckUpdate(deck: Deck, historySource: string): void {
    this.deck.set({ ...deck, cards: this.deckCardsOf(deck) });
    this.validation.set(null);
    this.cardMenu.set(null);
    this.recordHistory(deck, historySource);
    void this.refreshTokens(deck.id);
    if (!Array.isArray(deck.cards)) {
      void this.reloadDeckCards(deck.id);
    }
  }

  private async moveCardIntoCommander(currentDeck: Deck, entry: DeckCard): Promise<Deck> {
    if (entry.section === 'commander') {
      return currentDeck;
    }

    const currentCommanders = (currentDeck.cards ?? []).filter((candidate) => candidate.section === 'commander');
    if (currentCommanders.length >= 2) {
      throw new Error('Commander slot already has two cards.');
    }

    let response = await firstValueFrom(this.decksApi.replaceCommanders(currentDeck.id, [
      ...currentCommanders.map((candidate) => ({ scryfallId: candidate.card.scryfallId })),
      { scryfallId: entry.card.scryfallId },
    ]));
    let nextDeck = await this.ensureDeckCardsLoaded(response.deck);

    if (entry.section !== 'main') {
      const sourceEntry = this.deckCardsOf(nextDeck).find((candidate) => (
        candidate.section === entry.section
        && candidate.card.scryfallId === entry.card.scryfallId
      ));
      if (sourceEntry) {
        response = sourceEntry.quantity > 1
          ? await firstValueFrom(this.decksApi.updateCard(nextDeck.id, sourceEntry.id, { quantity: sourceEntry.quantity - 1 }))
          : await firstValueFrom(this.decksApi.removeCard(nextDeck.id, sourceEntry.id));
        nextDeck = await this.ensureDeckCardsLoaded(response.deck);
      }
    }

    return nextDeck;
  }

  private async moveCommanderOut(currentDeck: Deck, entry: DeckCard, target: Exclude<DeckSection, 'commander'>): Promise<Deck> {
    const remainingCommanders = (currentDeck.cards ?? [])
      .filter((candidate) => candidate.section === 'commander' && candidate.id !== entry.id)
      .map((candidate) => ({ scryfallId: candidate.card.scryfallId }));

    let response = await firstValueFrom(this.decksApi.replaceCommanders(currentDeck.id, remainingCommanders));
    let nextDeck = await this.ensureDeckCardsLoaded(response.deck);
    if (target === 'main') {
      return nextDeck;
    }

    const mainEntry = this.deckCardsOf(nextDeck).find((candidate) => (
      candidate.section === 'main'
      && candidate.card.scryfallId === entry.card.scryfallId
    ));
    if (!mainEntry) {
      return nextDeck;
    }

    if (mainEntry.quantity > 1) {
      response = await firstValueFrom(this.decksApi.updateCard(nextDeck.id, mainEntry.id, { quantity: mainEntry.quantity - 1 }));
      response = await firstValueFrom(this.decksApi.addCard(nextDeck.id, {
        scryfallId: entry.card.scryfallId,
        quantity: 1,
        section: target,
      }));
      return this.ensureDeckCardsLoaded(response.deck);
    }

    response = await firstValueFrom(this.decksApi.updateCard(nextDeck.id, mainEntry.id, { section: target }));
    return this.ensureDeckCardsLoaded(response.deck);
  }

  private sectionLabel(section: DeckSection): string {
    switch (section) {
      case 'commander':
        return 'commander';
      case 'sideboard':
        return 'sideboard';
      case 'maybeboard':
        return 'considering';
      default:
        return 'main';
    }
  }

  private async refreshTokens(deckId: string): Promise<void> {
    try {
      const response = await firstValueFrom(this.decksApi.tokens(deckId));
      this.tokens.set(response.data);
      this.unresolvedTokens.set(response.unresolved);
    } catch {
      this.tokens.set([]);
      this.unresolvedTokens.set([]);
    }
  }

  private async reloadDeckCards(deckId: string): Promise<void> {
    try {
      const response = await firstValueFrom(this.decksApi.get(deckId));
      this.deck.set(response.deck);
    } catch {
      return;
    }
  }

  private cardMenuAmount(): number {
    return this.cardMenu()?.amount ?? 1;
  }

  private async addCopiesToMain(currentDeck: Deck, card: Card, amount: number) {
    const existingEntry = (currentDeck.cards ?? []).find((entry) => (
      entry.section === 'main' && entry.card.name.trim().toLowerCase() === card.name.trim().toLowerCase()
    ));

    if (existingEntry) {
      return firstValueFrom(this.decksApi.updateCard(currentDeck.id, existingEntry.id, {
        quantity: existingEntry.quantity + amount,
      }));
    }

    return firstValueFrom(this.decksApi.addCard(currentDeck.id, {
      scryfallId: card.scryfallId,
      quantity: amount,
      section: 'main',
    }));
  }

  private buildManaSourceProfiles(): Array<{
    color: 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
    label: string;
    demandCount: number;
    demandPercent: number;
    sourceCount: number;
    sourcePercent: number;
  }> {
    const demandProfiles = this.analysis().colorProfiles;
    const sourceCounts: Record<'W' | 'U' | 'B' | 'R' | 'G' | 'C', number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    const deckColors = this.deckColorIdentity();
    const sourceEntries = (this.deck()?.cards ?? []).filter((entry) => entry.section === 'main' && this.isManaSourceCard(entry));

    for (const entry of sourceEntries) {
      for (const color of this.manaSourceColors(entry, deckColors)) {
        sourceCounts[color] += entry.quantity;
      }
    }

    const totalSources = Object.values(sourceCounts).reduce((sum, value) => sum + value, 0);
    const labels: Record<'W' | 'U' | 'B' | 'R' | 'G' | 'C', string> = {
      W: 'White',
      U: 'Blue',
      B: 'Black',
      R: 'Red',
      G: 'Green',
      C: 'Colorless',
    };

    return (['W', 'U', 'B', 'R', 'G', 'C'] as const)
      .map((color) => {
        const demand = demandProfiles.find((entry) => entry.color === color);
        return {
          color,
          label: labels[color],
          demandCount: demand?.count ?? 0,
          demandPercent: demand?.percent ?? 0,
          sourceCount: sourceCounts[color],
          sourcePercent: totalSources > 0 ? Math.round((sourceCounts[color] / totalSources) * 100) : 0,
        };
      })
      .filter((entry) => entry.demandCount > 0 || entry.sourceCount > 0);
  }

  private buildManaSourceDonutBackground(): string {
    const profiles = this.manaSourceProfiles();
    if (profiles.length === 0) {
      return 'conic-gradient(rgb(255 255 255 / 8%) 0deg 360deg)';
    }

    const palette: Record<'W' | 'U' | 'B' | 'R' | 'G' | 'C', string> = {
      W: '#f1ebac',
      U: '#9fc4ec',
      B: '#8a7f84',
      R: '#e29a79',
      G: '#8fbe78',
      C: '#d8d8d8',
    };

    let cursor = 0;
    const stops = profiles.map((profile) => {
      const start = cursor;
      const width = Math.max(profile.sourcePercent, profile.sourceCount > 0 ? 2 : 0);
      cursor += width;
      return `${palette[profile.color]} ${start}% ${Math.min(cursor, 100)}%`;
    });

    return `conic-gradient(${stops.join(', ')})`;
  }

  private distinctSearchCards(cards: Card[]): Card[] {
    const seen = new Set<string>();

    return cards.filter((card) => {
      const key = this.cardSearchDistinctKey(card);
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  private cardSearchDistinctKey(card: Card): string {
    return [
      card.name.trim().toLowerCase(),
      card.manaCost ?? '',
      card.typeLine ?? '',
      card.oracleText ?? '',
    ].join('|');
  }

  private isSpellEntry(entry: DeckCard): boolean {
    const typeLine = entry.card.typeLine?.toLowerCase() ?? '';

    return typeLine.includes('instant') || typeLine.includes('sorcery');
  }

  private normalizeMissingSection(section: string): DeckSection {
    if (section === 'commander' || section === 'sideboard' || section === 'maybeboard') {
      return section;
    }

    return 'main';
  }

  private deckCardsOf(deck: Deck | null | undefined): DeckCard[] {
    return Array.isArray(deck?.cards) ? deck.cards : [];
  }

  private async ensureDeckCardsLoaded(deck: Deck): Promise<Deck> {
    if (Array.isArray(deck.cards)) {
      return deck;
    }

    const response = await firstValueFrom(this.decksApi.get(deck.id));
    return response.deck;
  }

  private filterAndDistinctSearchCards(cards: Card[], query: string): Card[] {
    const normalizedQuery = normalizeDeckSearch(query);
    const filtered = cards
      .filter((card) => this.cardSearchHaystack(card).includes(normalizedQuery))
      .sort((left, right) => {
        const leftIndex = this.cardSearchHaystack(left).indexOf(normalizedQuery);
        const rightIndex = this.cardSearchHaystack(right).indexOf(normalizedQuery);
        if (leftIndex !== rightIndex) {
          return leftIndex - rightIndex;
        }

        return left.name.localeCompare(right.name);
      });

    return this.distinctSearchCards(filtered);
  }

  private cardSearchHaystack(card: Card): string {
    return normalizeDeckSearch([
      card.name,
      card.printedName ?? '',
      card.flavorName ?? '',
    ].join(' '));
  }

  private deckColorIdentity(): Array<'W' | 'U' | 'B' | 'R' | 'G'> {
    const colors = new Set<'W' | 'U' | 'B' | 'R' | 'G'>();
    for (const entry of this.commanderCards()) {
      for (const color of entry.card.colorIdentity ?? []) {
        if (color === 'W' || color === 'U' || color === 'B' || color === 'R' || color === 'G') {
          colors.add(color);
        }
      }
    }

    if (colors.size > 0) {
      return Array.from(colors);
    }

    return ['W', 'U', 'B', 'R', 'G'].filter((color) => (
      this.analysis().colorProfiles.some((profile) => profile.color === color && profile.count > 0)
    )) as Array<'W' | 'U' | 'B' | 'R' | 'G'>;
  }

  private isManaSourceCard(entry: DeckCard): boolean {
    if (hasType(entry, 'land')) {
      return true;
    }

    if (this.isSpellEntry(entry)) {
      return false;
    }

    const oracle = entry.card.oracleText?.toLowerCase() ?? '';
    return /add /.test(oracle) || /treasure token/.test(oracle);
  }

  private manaSourceColors(entry: DeckCard, deckColors: Array<'W' | 'U' | 'B' | 'R' | 'G'>): Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'> {
    const colors = new Set<'W' | 'U' | 'B' | 'R' | 'G' | 'C'>();
    const typeLine = entry.card.typeLine?.toLowerCase() ?? '';
    const oracle = entry.card.oracleText?.toLowerCase() ?? '';
    const basicTypes: Record<'W' | 'U' | 'B' | 'R' | 'G', string> = {
      W: 'plains',
      U: 'island',
      B: 'swamp',
      R: 'mountain',
      G: 'forest',
    };

    for (const [color, basicType] of Object.entries(basicTypes) as Array<['W' | 'U' | 'B' | 'R' | 'G', string]>) {
      if (typeLine.includes(basicType) || oracle.includes(`{${color.toLowerCase()}}`) || oracle.includes(`{${color}}`) || oracle.includes(basicType)) {
        colors.add(color);
      }
    }

    if (/any color in your commander's color identity/.test(oracle)) {
      for (const color of (deckColors.length > 0 ? deckColors : ['W', 'U', 'B', 'R', 'G'] as const)) {
        colors.add(color);
      }
    } else if (/any color|mana of any type/.test(oracle)) {
      for (const color of ['W', 'U', 'B', 'R', 'G'] as const) {
        colors.add(color);
      }
    }

    if (oracle.includes('{c}') || /colorless/.test(oracle) || entry.card.colorIdentity?.length === 0) {
      colors.add('C');
    }

    for (const color of entry.card.colorIdentity ?? []) {
      if (color === 'W' || color === 'U' || color === 'B' || color === 'R' || color === 'G') {
        colors.add(color);
      }
    }

    return Array.from(colors);
  }

  private normalizeQuantity(value: unknown): number {
    const parsed = Number.parseInt(String(value ?? '1'), 10);

    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  private apiErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.error === 'string' && error.error.error.trim()) {
      return error.error.error;
    }

    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return fallback;
  }

  private deckFormatKey(): string {
    const raw = (this.deck()?.format ?? 'commander').trim().toLowerCase();
    return raw.replace(/[\s-]+/g, '_');
  }

  private deckFormatLabel(): string {
    const raw = (this.deck()?.format ?? 'commander').trim().replace(/[_-]+/g, ' ');
    if (!raw) {
      return 'Commander';
    }

    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  hasAlternateFace(card: Card): boolean {
    return card.name.includes('//');
  }

  displayCardName(card: Card): string {
    if (!this.hasAlternateFace(card)) {
      return card.name;
    }

    const [front, back] = card.name.split('//').map((part) => part.trim());
    return this.isFaceFlipped(card) ? `${back} // ${front}` : `${front} // ${back}`;
  }

  displayCardTypeLine(card: Card): string | null {
    if (!card.typeLine) {
      return null;
    }

    if (!this.hasAlternateFace(card)) {
      return card.typeLine;
    }

    const [front, back] = card.typeLine.split('//').map((part) => part.trim());
    if (!front || !back) {
      return card.typeLine;
    }

    return this.isFaceFlipped(card) ? `${back} // ${front}` : `${front} // ${back}`;
  }

  toggleCardFace(event: MouseEvent, card: Card): void {
    event.stopPropagation();
    const next = { ...this.flippedFaces() };
    next[card.scryfallId] = !next[card.scryfallId];
    this.flippedFaces.set(next);
  }

  private isFaceFlipped(card: Card): boolean {
    return this.flippedFaces()[card.scryfallId] ?? false;
  }
}

function hasType(entry: DeckCard, type: string): boolean {
  return new RegExp(`(^|\\s)${type}(\\s|$)`, 'i').test(entry.card.typeLine ?? '');
}

function sanitizeDeckSearchQuery(value: string): string {
  return value
    .replace(/[^A-Za-zÀ-ÿ\s]/g, '')
    .replace(/\s+/g, ' ')
    .trimStart();
}

function normalizeDeckSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}
