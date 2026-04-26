import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { CardsApi } from '../../core/api/cards.api';
import { DecksApi } from '../../core/api/decks.api';
import { Card } from '../../core/models/card.model';
import { CommanderValidation, Deck, DeckCard, DeckSection } from '../../core/models/deck.model';
import { ManaSymbolsComponent } from '../../shared/mana/mana-symbols.component';
import { bestCardImage } from '../../shared/utils/card-image';
import { AppModalComponent } from '../../shared/ui/app-modal.component';
import { ClientCommanderValidationService } from './client-commander-validation.service';
import { DeckAnalysisService } from './deck-analysis.service';
import { DeckHistoryEntry, DeckHistoryStore } from './deck-history.store';
import { DeckImportExportService, DecklistEntry } from './deck-import-export.service';
import { MissingCardsStore } from './missing-cards.store';

type DeckEditorTab = 'analysis' | 'validation' | 'missing' | 'history';

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
}

const GROUPS: Array<{ id: string; title: string; matcher: (entry: DeckCard) => boolean }> = [
  { id: 'commander', title: 'Comandante', matcher: (entry) => entry.section === 'commander' },
  { id: 'planeswalker', title: 'Planeswalkers', matcher: (entry) => hasType(entry, 'planeswalker') },
  { id: 'creature', title: 'Criaturas', matcher: (entry) => hasType(entry, 'creature') },
  { id: 'instant', title: 'Instantaneos', matcher: (entry) => hasType(entry, 'instant') },
  { id: 'sorcery', title: 'Conjuros', matcher: (entry) => hasType(entry, 'sorcery') },
  { id: 'enchantment', title: 'Encantamientos', matcher: (entry) => hasType(entry, 'enchantment') },
  { id: 'artifact', title: 'Artefactos', matcher: (entry) => hasType(entry, 'artifact') },
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
          <div class="button-row wrap-row">
            <div class="deck-add-search">
              <lucide-icon name="search" size="16" />
              <input
                name="deckCardSearch"
                placeholder="Add cards by name"
                [(ngModel)]="cardSearchQuery"
                (ngModelChange)="onCardSearchQueryChange($event)"
              />
            </div>
            <button class="primary-button compact" type="button" (click)="openImportModal()">
              <lucide-icon name="upload" size="16" />
              Import
            </button>
          </div>
        </div>

        @if (cardSearchLoading()) {
          <p class="notice">Searching cards...</p>
        } @else if (cardSearchResults().length > 0) {
          <section class="panel card-search-panel">
            <div class="dense-list compact-list autocomplete-list">
              @for (card of cardSearchResults(); track card.scryfallId) {
                <div class="autocomplete-item card-search-result">
                  <span>
                    <strong>{{ card.name }}</strong>
                    <small>{{ card.typeLine || 'Unknown type' }}</small>
                  </span>
                  <div class="button-row">
                    <small><app-mana-symbols [value]="card.manaCost" fallback="No cost" /></small>
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
                                    {{ entry.quantity }} - {{ entry.card.name }}
                                    @if (isCommanderIllegal(entry)) {
                                      <lucide-icon class="warning-mark" name="triangle-alert" size="14" />
                                    }
                                  </strong>
                                </span>
                                <small class="deck-card-secondary">{{ entry.card.typeLine || 'Unknown type' }}</small>
                                <span class="deck-card-cost">
                                  @if (shouldShowManaCost(entry.card)) {
                                    <app-mana-symbols [value]="entry.card.manaCost" fallback="-" />
                                  }
                                </span>
                              </div>
                              @if (cardMenu()?.entryId === entry.id) {
                                <div class="card-row-menu" [style.top.px]="cardMenu()!.top" [style.left.px]="cardMenu()!.left" (click)="$event.stopPropagation()">
                                  <button type="button" (click)="noopCardAction($event)">Add copy</button>
                                  <button type="button" (click)="noopCardAction($event)">Remove copy</button>
                                  <button type="button" (click)="noopCardAction($event)">Move to main</button>
                                  <button type="button" (click)="noopCardAction($event)">Move to commander</button>
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

                <p class="analysis-footnote">
                  Average {{ analysis().averageManaValueWithLands }} with lands and {{ analysis().averageManaValue }} without lands.
                  Median {{ analysis().medianManaValueWithLands }} with lands and {{ analysis().medianManaValue }} without lands.
                  Total mana value {{ analysis().totalManaValue }}.
                </p>
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
              <section class="analysis-panel compact-analysis-panel">
                <h3>Mana profile</h3>
                <div class="analysis-color-grid compact-color-grid">
                  @for (profile of visibleColorProfiles(); track profile.color) {
                    <div class="color-profile-card compact-color-card">
                      <div class="color-profile-top">
                        <app-mana-symbols [symbols]="[profile.color]" />
                        <strong>{{ profile.percent }}%</strong>
                      </div>
                      <small>{{ profile.count }} symbols</small>
                      <div class="color-profile-bar">
                        <span [style.width.%]="profile.percent"></span>
                      </div>
                    </div>
                  }
                </div>
              </section>

              <section class="analysis-panel compact-analysis-panel">
                <h3>Land types</h3>
                <div class="pip-row roomy-pip-row compact-land-row">
                  @for (land of visibleLandTypes(); track land.label) {
                    <span class="pip symbol-count roomy-pip">
                      <app-mana-symbols [symbols]="[land.symbol]" />
                      {{ land.label }} {{ land.count }}
                    </span>
                  }
                </div>
              </section>
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
                        @if (isCardIllegal(card)) {
                          <lucide-icon class="warning-mark" name="triangle-alert" size="14" />
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
  readonly missingSourceEntries = signal<DecklistEntry[]>([]);
  readonly missingSearch = signal<MissingSearchResult | null>(null);
  readonly missingAddTarget = signal<string | null>(null);
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
  readonly collapsedGroups = signal<Set<string>>(new Set());
  readonly mainCards = computed(() => this.cardsBySection('main'));
  readonly commanderCards = computed(() => this.cardsBySection('commander'));
  readonly totalCards = computed(() => (this.deck()?.cards ?? []).reduce((total, entry) => total + entry.quantity, 0));
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
  readonly visibleColorProfiles = computed(() => this.analysis().colorProfiles.filter((entry) => entry.count > 0));
  readonly visibleLandTypes = computed(() => this.analysis().landTypes.filter((land) => land.count > 0));
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
      const response = await firstValueFrom(this.decksApi.get(id));
      this.deck.set(response.deck);
      this.deckName = response.deck.name;
      this.refreshHistory(response.deck.id);
    } catch {
      this.error.set('Could not load deck.');
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
    } catch {
      this.error.set('Could not rename deck.');
    }
  }

  async importDeck(id: string): Promise<void> {
    try {
      let entries = this.importExport.parse(this.decklist, 'plain');
      let response = await firstValueFrom(this.decksApi.importDecklist(id, this.importExport.toBackendDecklist(entries)));
      if (response.missing.length > 0) {
        const resolvedEntries = await this.importExport.resolveMissingFlavorNames(entries, response.missing);
        if (this.entriesChanged(entries, resolvedEntries)) {
          entries = resolvedEntries;
          response = await firstValueFrom(this.decksApi.importDecklist(id, this.importExport.toBackendDecklist(entries)));
        }
      }
      this.deck.set(response.deck);
      this.missing.set(response.missing);
      this.missingSourceEntries.set(entries);
      this.lastImportStats.set({
        parsedCards: entries.reduce((total, entry) => total + entry.quantity, 0),
        importedCards: (response.deck.cards ?? []).reduce((total, entry) => total + entry.quantity, 0),
        missingCards: response.missing.length,
      });
      this.validation.set(null);
      this.missingSearch.set(null);
      this.recordHistory(response.deck, 'Import plain text');
      if (response.missing.length > 0) {
        this.activeTab.set('missing');
      } else {
        this.importModalOpen.set(false);
      }
    } catch {
      this.error.set('Could not import deck.');
    }
  }

  async validate(id: string): Promise<void> {
    try {
      const response = await firstValueFrom(this.decksApi.validateCommander(id));
      this.validation.set(response);
    } catch {
      this.error.set('Could not validate deck.');
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
    this.cardSearchQuery = value;
    if (this.cardSearchTimeout) {
      clearTimeout(this.cardSearchTimeout);
    }

    const query = value.trim();
    if (query.length < 2) {
      this.cardSearchResults.set([]);
      this.cardSearchLoading.set(false);
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
    } catch {
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
    const source = this.missingSourceEntries().find((entry) => entry.name.toLowerCase() === targetName.toLowerCase());
    try {
      const response = await firstValueFrom(this.decksApi.addCard(currentDeck.id, {
        scryfallId: card.scryfallId,
        quantity: source?.quantity ?? 1,
        section: source?.section ?? 'main',
      }));
      this.deck.set(response.deck);
      this.missing.set(this.missing().filter((name) => name !== targetName));
      this.validation.set(null);
      this.recordHistory(response.deck, `Manual add ${card.name}`);
    } catch {
      this.error.set('Could not add selected card.');
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
      this.validation.set(null);
      this.refreshHistory(deckId);
      this.restoreModalOpen.set(false);
      this.restoreTarget.set(null);
    } catch {
      this.error.set('Could not restore history entry.');
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
    return this.isCardIllegal(entry.card);
  }

  isCardIllegal(card: Card): boolean {
    return !card.commanderLegal || ['banned', 'not_legal'].includes(card.legalities['commander'] ?? '');
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
    });
  }

  noopCardAction(event: MouseEvent): void {
    event.stopPropagation();
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
      const response = await firstValueFrom(this.cardsApi.search(query, 1, 8));
      if (version === this.cardSearchVersion && query === this.cardSearchQuery.trim()) {
        this.cardSearchResults.set(response.data);
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

    try {
      const response = await firstValueFrom(this.decksApi.addCard(currentDeck.id, {
        scryfallId: card.scryfallId,
        quantity: 1,
        section: 'main',
      }));
      this.deck.set(response.deck);
      this.validation.set(null);
      this.recordHistory(response.deck, `Manual add ${card.name}`);
      this.cardSearchQuery = '';
      this.cardSearchResults.set([]);
    } catch {
      this.error.set('Could not add selected card.');
    }
  }

  private refreshHistory(deckId: string): void {
    this.history.set(this.historyStore.list(deckId));
  }

  private buildMissingItems(): MissingCardItem[] {
    return this.missing()
      .filter((name) => !this.missingStore.isIgnored(name))
      .map((name) => {
        const source = this.missingSourceEntries().find((entry) => entry.name.toLowerCase() === name.toLowerCase());

        return {
          name,
          quantity: source?.quantity ?? 1,
          section: source?.section ?? 'main',
          watched: this.missingStore.isWatched(name),
        };
      });
  }

  private buildCardGroups(): DeckCardGroup[] {
    const cards = [...(this.deck()?.cards ?? [])].sort((left, right) => left.card.name.localeCompare(right.card.name));
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
        && group.cards.length > 4;

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

  private entriesChanged(current: DecklistEntry[], next: DecklistEntry[]): boolean {
    return current.some((entry, index) => entry.name !== next[index]?.name);
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

  private isSpellEntry(entry: DeckCard): boolean {
    const typeLine = entry.card.typeLine?.toLowerCase() ?? '';

    return typeLine.includes('instant') || typeLine.includes('sorcery');
  }
}

function hasType(entry: DeckCard, type: string): boolean {
  return new RegExp(`(^|\\s)${type}(\\s|$)`, 'i').test(entry.card.typeLine ?? '');
}
