import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { CardsApi } from '../../core/api/cards.api';
import { DecksApi } from '../../core/api/decks.api';
import { Card } from '../../core/models/card.model';
import { CommanderValidation, Deck, DeckCard, DeckSection } from '../../core/models/deck.model';
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

@Component({
  selector: 'app-deck-editor',
  imports: [FormsModule, RouterLink, LucideAngularModule, AppModalComponent],
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
          <button class="primary-button compact" type="button" (click)="openImportModal()">
            <lucide-icon name="upload" size="16" />
            Import
          </button>
        </div>

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

        <div class="editor-layout wide-editor">
          <section class="panel">
            @if (activeTab() === 'analysis') {
              <div class="analysis-grid">
                <div class="stat-tile"><span>Total</span><strong>{{ analysis().totalCards }}</strong></div>
                <div class="stat-tile"><span>Lands</span><strong>{{ analysis().landCount }}</strong></div>
                <div class="stat-tile"><span>Nonlands</span><strong>{{ analysis().nonlandCount }}</strong></div>
                <div class="stat-tile"><span>Commanders</span><strong>{{ commanderCards().length }}</strong></div>
              </div>

              <h3>Mana curve</h3>
              <div class="curve-grid">
                @for (bucket of analysis().manaCurve; track bucket.manaValue) {
                  <div class="curve-bar">
                    <span>{{ bucket.manaValue === 7 ? '7+' : bucket.manaValue }}</span>
                    <strong [style.height.%]="curveHeight(bucket.count)"></strong>
                    <small>{{ bucket.count }}</small>
                  </div>
                }
              </div>

              <h3>Color pips</h3>
              <div class="pip-row">
                @for (color of pipColors; track color) {
                  <span
                    class="pip"
                    [class.pip-w]="color === 'W'"
                    [class.pip-u]="color === 'U'"
                    [class.pip-b]="color === 'B'"
                    [class.pip-r]="color === 'R'"
                    [class.pip-g]="color === 'G'"
                  >
                    {{ color }} {{ analysis().colorPips[color] }}
                  </span>
                }
              </div>

              <h3>Role counts</h3>
              <div class="analysis-grid">
                @for (metric of typeMetrics(); track metric.label) {
                  <div class="stat-tile large">
                    <span>{{ metric.label }}</span>
                    <strong>{{ metric.count }}</strong>
                    <small>{{ metric.cards.slice(0, 4).join(', ') || '-' }}</small>
                  </div>
                }
              </div>

              <h3>Utility counts</h3>
              <div class="analysis-grid">
                @for (metric of utilityMetrics(); track metric.label) {
                  <div class="stat-tile large">
                    <span>{{ metric.label }}</span>
                    <strong>{{ metric.count }}</strong>
                    <small>{{ metric.cards.slice(0, 4).join(', ') || '-' }}</small>
                  </div>
                }
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
                        <strong>{{ item.quantity }}x {{ item.name }}</strong>
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
                        <strong>{{ card.name }}</strong>
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

          <section class="panel">
            <div class="deck-summary">
              <strong>{{ totalCards() }} cards</strong>
              <span>{{ commanderCards().length }} commander entries</span>
              <span>{{ mainCards().length }} main entries</span>
            </div>

            <h3>Command zone</h3>
            <div class="dense-list compact-list">
              @for (entry of commanderCards(); track entry.id) {
                <div class="list-row">
                  <span><strong>{{ entry.quantity }}x {{ entry.card.name }}</strong><small>{{ entry.card.typeLine }}</small></span>
                  <span class="metric">{{ entry.card.manaCost || '-' }}</span>
                </div>
              }
            </div>

            <h3>Main deck</h3>
            <div class="dense-list compact-list">
              @for (entry of mainCards(); track entry.id) {
                <div class="list-row">
                  <span><strong>{{ entry.quantity }}x {{ entry.card.name }}</strong><small>{{ entry.card.typeLine }}</small></span>
                  <span class="metric">{{ entry.card.manaCost || '-' }}</span>
                </div>
              }
            </div>
          </section>
        </div>

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
export class DeckEditorComponent {
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
  readonly mainCards = computed(() => this.cardsBySection('main'));
  readonly commanderCards = computed(() => this.cardsBySection('commander'));
  readonly totalCards = computed(() => (this.deck()?.cards ?? []).reduce((total, entry) => total + entry.quantity, 0));
  readonly analysis = computed(() => this.analysisService.analyze(this.deck()));
  readonly clientIssues = computed(() => this.clientValidation.validate(this.deck()));
  readonly typeMetrics = computed(() => {
    const analysis = this.analysis();

    return [
      analysis.creatures,
      analysis.artifacts,
      analysis.enchantments,
      analysis.instants,
      analysis.sorceries,
      analysis.planeswalkers,
    ];
  });
  readonly utilityMetrics = computed(() => {
    const analysis = this.analysis();

    return [analysis.ramp, analysis.draw, analysis.removal, analysis.wipes];
  });
  readonly missingItems = computed(() => this.buildMissingItems());
  readonly pipColors = ['W', 'U', 'B', 'R', 'G'];

  deckName = '';
  decklist = '';
  missingSearchQuery = '';

  constructor() {
    void this.load();
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
      const entries = this.importExport.parse(this.decklist, 'plain');
      const normalized = this.importExport.toBackendDecklist(entries);
      const response = await firstValueFrom(this.decksApi.importDecklist(id, normalized));
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

  curveHeight(count: number): number {
    const max = Math.max(...this.analysis().manaCurve.map((bucket) => bucket.count), 1);

    return Math.max((count / max) * 100, count > 0 ? 12 : 0);
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
    const entries = [
      ...this.importExport.entriesFromDeck(currentDeck),
      {
        quantity: source?.quantity ?? 1,
        name: card.name,
        section: source?.section ?? 'main',
      },
    ];

    try {
      const response = await firstValueFrom(this.decksApi.importDecklist(currentDeck.id, this.importExport.toBackendDecklist(entries)));
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
    const preview = items.slice(0, 6).map((item) => `${item.quantity}x ${item.name}`).join(', ');

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

  private cardsBySection(section: DeckSection): DeckCard[] {
    return (this.deck()?.cards ?? []).filter((entry) => entry.section === section);
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
}
