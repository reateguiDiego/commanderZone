import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { CardsApi } from '../../core/api/cards.api';
import { DeckFoldersApi } from '../../core/api/deck-folders.api';
import { DeckFormatsApi } from '../../core/api/deck-formats.api';
import { DecksApi } from '../../core/api/decks.api';
import { Card } from '../../core/models/card.model';
import { Deck, DeckFolder, DeckFormat } from '../../core/models/deck.model';
import { ManaSymbolsComponent } from '../../shared/mana/mana-symbols.component';
import { AppModalComponent } from '../../shared/ui/app-modal.component';
import { DeckImportExportService, DecklistEntry } from './deck-import-export.service';

interface DeckFolderSection {
  id: string | null;
  name: string;
  decks: Deck[];
  isUnfiled: boolean;
}

@Component({
  selector: 'app-deck-list',
  imports: [FormsModule, RouterLink, LucideAngularModule, AppModalComponent, ManaSymbolsComponent],
  template: `
    <section class="page-stack">
      <div class="tool-header">
        <div>
          <span class="eyebrow">Decks</span>
          <h2>Decks</h2>
        </div>
        <div class="button-row wrap-row">
          <button class="primary-button compact" type="button" (click)="openCreateModal()">
            <lucide-icon name="plus" size="16" />
            Create deck
          </button>
          <button class="secondary-button compact" type="button" (click)="openFolderCreateModal()">
            <lucide-icon name="folder-plus" size="16" />
            Create folder
          </button>
          <button class="icon-button" type="button" title="Reload decks" (click)="reloadAll()">
            <lucide-icon name="refresh-ccw" size="16" />
          </button>
        </div>
      </div>

      @if (loading()) {
        <p class="notice">Loading decks...</p>
      } @else if (error()) {
        <p class="notice error">{{ error() }}</p>
      } @else if (decks().length === 0 && folders().length === 0) {
        <p class="notice">No decks yet. Create one and import a decklist.</p>
      }

      @if (!currentFolder()) {
        <section class="panel folder-panel">
          <div class="deck-table-header">
            <span>Name</span>
            <span>Format</span>
            <span>Price</span>
            <span></span>
          </div>
          <div class="dense-list deck-table-list">
            @for (folder of folders(); track folder.id) {
              <div class="deck-list-row deck-row-clickable" role="button" tabindex="0" (click)="enterFolder(folder.id)" (keydown.enter)="enterFolder(folder.id)">
                <span class="deck-link deck-table-name folder-row-name">
                  <span class="folder-icon-wrap small-folder-icon">
                    <lucide-icon name="folder" size="18" />
                  </span>
                  <strong>{{ folder.name }} ({{ folderDeckCount(folder.id) }})</strong>
                </span>
                <span class="deck-table-format">-</span>
                <span class="deck-table-price">-</span>
                <div class="deck-row-actions table-actions">
                  <button class="icon-button" type="button" title="Rename folder" (click)="openRenameFolderModal(folder); $event.stopPropagation()">
                    <lucide-icon name="pencil" size="15" />
                  </button>
                  <button class="icon-button danger" type="button" title="Delete folder" (click)="deleteFolder(folder); $event.stopPropagation()">
                    <lucide-icon name="trash-2" size="15" />
                  </button>
                </div>
              </div>
            }

            @for (deck of unfiledSection().decks; track deck.id) {
              <div class="deck-list-row deck-row-clickable" role="link" tabindex="0" (click)="openDeck(deck.id)" (keydown.enter)="openDeck(deck.id)">
                <span class="deck-link deck-table-name">
                  <strong>{{ deck.name }}</strong>
                </span>
                <span class="deck-table-format">{{ deckFormatLabel(deck) }}</span>
                <span class="deck-table-price">{{ deckPrice(deck) ?? '-' }}</span>
                <div class="deck-row-actions table-actions">
                  <select class="deck-folder-select" [ngModel]="deck.folderId ?? ''" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" (ngModelChange)="moveDeck(deck, $event)">
                    <option value="">No folder</option>
                    @for (folder of folderOptions(); track folder.id) {
                      <option [value]="folder.id">{{ folder.name }}</option>
                    }
                  </select>
                  <button class="icon-button danger" type="button" title="Delete deck" (click)="deleteDeck(deck); $event.stopPropagation()">
                    <lucide-icon name="trash-2" size="16" />
                  </button>
                </div>
              </div>
            }
          </div>
        </section>
      } @else {
        <section class="panel folder-panel">
          <div class="tool-header compact-header">
            <div class="folder-heading">
              <button class="text-button compact" type="button" (click)="leaveFolder()">
                <lucide-icon name="arrow-left" size="16" />
                Decks
              </button>
              <span class="folder-icon-wrap">
                <lucide-icon name="folder" size="18" />
              </span>
              <div>
                <h3>{{ currentFolder()!.name }}</h3>
              </div>
            </div>
            <div class="button-row">
              <button class="icon-button" type="button" title="Rename folder" (click)="openRenameFolderModal(currentFolder()!)">
                <lucide-icon name="pencil" size="16" />
              </button>
              <button class="icon-button danger" type="button" title="Delete folder" (click)="deleteFolder(currentFolder()!)">
                <lucide-icon name="trash-2" size="16" />
              </button>
            </div>
          </div>

          <div class="deck-table-header">
            <span>Name</span>
            <span>Format</span>
            <span>Price</span>
            <span></span>
          </div>
          <div class="dense-list deck-table-list">
            @for (deck of currentFolderSection().decks; track deck.id) {
              <div class="deck-list-row deck-row-clickable" role="link" tabindex="0" (click)="openDeck(deck.id)" (keydown.enter)="openDeck(deck.id)">
                <span class="deck-link deck-table-name">
                  <strong>{{ deck.name }}</strong>
                </span>
                <span class="deck-table-format">{{ deckFormatLabel(deck) }}</span>
                <span class="deck-table-price">{{ deckPrice(deck) ?? '-' }}</span>
                <div class="deck-row-actions table-actions">
                  <select class="deck-folder-select" [ngModel]="deck.folderId ?? ''" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" (ngModelChange)="moveDeck(deck, $event)">
                    <option value="">No folder</option>
                    @for (folder of folderOptions(); track folder.id) {
                      <option [value]="folder.id">{{ folder.name }}</option>
                    }
                  </select>
                  <button class="icon-button danger" type="button" title="Delete deck" (click)="deleteDeck(deck); $event.stopPropagation()">
                    <lucide-icon name="trash-2" size="16" />
                  </button>
                </div>
              </div>
            } @empty {
              <p class="notice">No decks in this folder yet.</p>
            }
          </div>
        </section>
      }

      <app-modal
        [open]="createModalOpen()"
        title="Create deck"
        primaryLabel="Create"
        secondaryLabel="Cancel"
        (primary)="create()"
        (secondary)="closeCreateModal()"
      >
        <div class="form-stack">
          <label>
            Deck name
            <input name="name" placeholder="New deck name" required [(ngModel)]="newDeckName" />
          </label>

          <label>
            Format
            <select name="format" [(ngModel)]="newDeckFormatId" (ngModelChange)="onFormatChange()">
              @for (format of formats(); track format.id) {
                <option [value]="format.id">{{ format.name }}</option>
              }
            </select>
          </label>

          <label>
            Folder
            <select name="folder" [(ngModel)]="newDeckFolderId">
              <option value="">No folder</option>
              @for (folder of folderOptions(); track folder.id) {
                <option [value]="folder.id">{{ folder.name }}</option>
              }
            </select>
          </label>

          @if (selectedFormat()?.hasCommander) {
            <label>
              Commander
              <input
                name="commanderSearch"
                placeholder="Search commander by name"
                [(ngModel)]="commanderQuery"
                (ngModelChange)="onCommanderQueryChange($event)"
              />
            </label>

            @if (selectedCommander(); as commander) {
              <div class="notice ok-notice">
                <strong>{{ commander.name }}</strong>
                <span>{{ commander.typeLine || 'Unknown type' }}</span>
              </div>
            }

            @if (commanderLoading()) {
              <p class="notice">Searching commanders...</p>
            } @else if (commanderResults().length > 0) {
              <div class="dense-list compact-list autocomplete-list">
                @for (card of commanderResults(); track card.scryfallId) {
                  <button class="autocomplete-item" type="button" (click)="selectCommander(card)">
                    <span>
                      <strong>{{ card.name }}</strong>
                      <small><app-mana-symbols [value]="card.manaCost" fallback="No cost" /></small>
                      <small>{{ card.typeLine || 'Unknown type' }}</small>
                    </span>
                  </button>
                }
              </div>
            }
          }
        </div>
      </app-modal>

      <app-modal
        [open]="folderCreateModalOpen()"
        title="Create folder"
        primaryLabel="Create"
        secondaryLabel="Cancel"
        (primary)="createFolder()"
        (secondary)="closeFolderCreateModal()"
      >
        <div class="form-stack">
          <label>
            Folder name
            <input name="folderName" placeholder="Jeskai, Brews, Testing..." [(ngModel)]="newFolderName" />
          </label>
        </div>
      </app-modal>

      <app-modal
        [open]="folderRenameModalOpen()"
        title="Rename folder"
        primaryLabel="Save"
        secondaryLabel="Cancel"
        (primary)="renameFolder()"
        (secondary)="closeFolderRenameModal()"
      >
        <div class="form-stack">
          <label>
            Folder name
            <input name="renameFolderName" [(ngModel)]="renameFolderName" />
          </label>
        </div>
      </app-modal>

      <app-modal
        [open]="folderDeleteModalOpen()"
        title="Delete folder"
        [message]="folderTarget() ? 'Delete ' + folderTarget()!.name + '? Decks will stay without folder.' : ''"
        primaryLabel="Delete"
        secondaryLabel="Cancel"
        [danger]="true"
        (primary)="confirmDeleteFolder()"
        (secondary)="folderDeleteModalOpen.set(false)"
      />

      <app-modal
        [open]="importModalOpen()"
        title="Import decklist"
        primaryLabel="Import"
        secondaryLabel="Cancel"
        (primary)="importCreatedDeck()"
        (secondary)="closeImportModal()"
      >
        <div class="form-stack">
          @if (createdDeck(); as deck) {
            <p class="notice">Importing into {{ deck.name }}.</p>
          }
          <label>
            Plain text decklist
            <textarea name="createdDecklist" rows="12" placeholder="1 Sol Ring (VOC) 168" [(ngModel)]="createdDecklist"></textarea>
          </label>
          @if (createdImportMessage()) {
            <p class="notice" [class.warning]="createdMissing().length > 0">{{ createdImportMessage() }}</p>
          }
          @if (createdMissing().length > 0) {
            <div class="notice warning">
              <strong>Missing cards</strong>
              <span>{{ createdMissing().join(', ') }}</span>
            </div>
          }
          @if (createdDeck(); as deck) {
            <a class="text-button" [routerLink]="['/decks', deck.id]">Open deck</a>
          }
        </div>
      </app-modal>

      <app-modal
        [open]="deleteModalOpen()"
        title="Delete deck"
        [message]="deleteTarget() ? 'Delete ' + deleteTarget()!.name + '?' : ''"
        primaryLabel="Delete"
        secondaryLabel="Cancel"
        [danger]="true"
        (primary)="confirmDeleteDeck()"
        (secondary)="deleteModalOpen.set(false)"
      />
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckListComponent {
  private readonly decksApi = inject(DecksApi);
  private readonly deckFoldersApi = inject(DeckFoldersApi);
  private readonly deckFormatsApi = inject(DeckFormatsApi);
  private readonly cardsApi = inject(CardsApi);
  private readonly router = inject(Router);
  private readonly importExport = inject(DeckImportExportService);

  readonly decks = signal<Deck[]>([]);
  readonly folders = signal<DeckFolder[]>([]);
  readonly folderOptions = signal<DeckFolder[]>([]);
  readonly formats = signal<DeckFormat[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly createModalOpen = signal(false);
  readonly folderCreateModalOpen = signal(false);
  readonly folderRenameModalOpen = signal(false);
  readonly folderDeleteModalOpen = signal(false);
  readonly importModalOpen = signal(false);
  readonly deleteModalOpen = signal(false);
  readonly deleteTarget = signal<Deck | null>(null);
  readonly folderTarget = signal<DeckFolder | null>(null);
  readonly createdDeck = signal<Deck | null>(null);
  readonly createdMissing = signal<string[]>([]);
  readonly createdImportMessage = signal<string | null>(null);
  readonly commanderResults = signal<Card[]>([]);
  readonly commanderLoading = signal(false);
  readonly selectedCommander = signal<Card | null>(null);
  readonly currentFolderId = signal<string | null>(null);
  readonly folderSections = computed<DeckFolderSection[]>(() => {
    const sections: DeckFolderSection[] = this.folders().map((folder) => ({
      id: folder.id,
      name: folder.name,
      decks: this.decks().filter((deck) => deck.folderId === folder.id),
      isUnfiled: false,
    }));

    sections.push({
      id: null,
      name: 'No folder',
      decks: this.decks().filter((deck) => deck.folderId === null),
      isUnfiled: true,
    });

    return sections;
  });
  readonly currentFolder = computed(() => this.folders().find((folder) => folder.id === this.currentFolderId()) ?? null);
  readonly currentFolderSection = computed<DeckFolderSection>(() => (
    this.folderSections().find((section) => section.id === this.currentFolderId())
    ?? { id: this.currentFolderId(), name: 'Unknown folder', decks: [], isUnfiled: false }
  ));
  readonly unfiledSection = computed<DeckFolderSection>(() => (
    this.folderSections().find((section) => section.isUnfiled)
    ?? { id: null, name: 'No folder', decks: [], isUnfiled: true }
  ));

  newDeckName = '';
  newDeckFormatId = 'commander';
  newDeckFolderId = '';
  newFolderName = '';
  renameFolderName = '';
  commanderQuery = '';
  createdDecklist = '';
  private commanderSearchTimeout: ReturnType<typeof setTimeout> | null = null;
  private commanderSearchVersion = 0;
  private lastCommanderQuery = '';
  private lastCommanderResultsSignature = '';

  constructor() {
    void this.reloadAll();
  }

  async reloadAll(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const [decksResponse, foldersResponse, folderNamesResponse, formatsResponse] = await Promise.all([
        firstValueFrom(this.decksApi.list()),
        firstValueFrom(this.deckFoldersApi.list()),
        firstValueFrom(this.deckFoldersApi.names()),
        firstValueFrom(this.deckFormatsApi.list()),
      ]);
      this.decks.set(decksResponse.data);
      this.folders.set(foldersResponse.data);
      this.folderOptions.set(folderNamesResponse.data);
      this.formats.set(formatsResponse.data);
      if (!this.formats().some((format) => format.id === this.newDeckFormatId) && this.formats().length > 0) {
        this.newDeckFormatId = this.formats()[0].id;
      }
    } catch {
      this.error.set('Could not load decks.');
    } finally {
      this.loading.set(false);
    }
  }

  openCreateModal(): void {
    this.createModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.newDeckName = '';
    this.newDeckFormatId = this.formats()[0]?.id ?? 'commander';
    this.newDeckFolderId = '';
    this.commanderQuery = '';
    this.commanderResults.set([]);
    this.selectedCommander.set(null);
    this.lastCommanderQuery = '';
    this.lastCommanderResultsSignature = '';
    this.createModalOpen.set(false);
  }

  onFormatChange(): void {
    if (!this.selectedFormat()?.hasCommander) {
      this.commanderQuery = '';
      this.commanderResults.set([]);
      this.selectedCommander.set(null);
      this.lastCommanderQuery = '';
      this.lastCommanderResultsSignature = '';
    }
  }

  onCommanderQueryChange(value: string): void {
    this.commanderQuery = value;
    if (this.selectedCommander()?.name !== value.trim()) {
      this.selectedCommander.set(null);
    }

    if (this.commanderSearchTimeout) {
      clearTimeout(this.commanderSearchTimeout);
    }

    const query = value.trim();
    if (query.length < 2 || !this.selectedFormat()?.hasCommander) {
      this.commanderResults.set([]);
      this.commanderLoading.set(false);
      return;
    }

    this.commanderLoading.set(true);
    const searchVersion = ++this.commanderSearchVersion;
    this.commanderSearchTimeout = setTimeout(() => {
      void this.searchCommander(query, searchVersion);
    }, 320);
  }

  private async searchCommander(query: string, searchVersion: number): Promise<void> {
    try {
      const response = await firstValueFrom(this.cardsApi.search(query, 1, 8, { commanderLegal: true }));
      if (searchVersion !== this.commanderSearchVersion || query !== this.commanderQuery.trim()) {
        return;
      }

      const distinctCards = this.distinctCommanders(response.data);
      const signature = distinctCards.map((card) => this.commanderDistinctKey(card)).join('|');
      if (signature === this.lastCommanderResultsSignature && query === this.lastCommanderQuery) {
        return;
      }

      this.lastCommanderQuery = query;
      this.lastCommanderResultsSignature = signature;
      this.commanderResults.set(distinctCards);
    } catch {
      this.commanderResults.set([]);
    } finally {
      if (searchVersion === this.commanderSearchVersion) {
        this.commanderLoading.set(false);
      }
    }
  }

  selectCommander(card: Card): void {
    this.selectedCommander.set(card);
    this.commanderQuery = card.name;
    this.commanderResults.set([]);
  }

  openFolderCreateModal(): void {
    this.newFolderName = '';
    this.folderCreateModalOpen.set(true);
  }

  closeFolderCreateModal(): void {
    this.newFolderName = '';
    this.folderCreateModalOpen.set(false);
  }

  async createFolder(): Promise<void> {
    const name = this.newFolderName.trim();
    if (!name) {
      return;
    }

    try {
      const response = await firstValueFrom(this.deckFoldersApi.create(name));
      this.folders.set([response.folder, ...this.folders()]);
      this.folderOptions.set([response.folder, ...this.folderOptions()]);
      this.closeFolderCreateModal();
    } catch {
      this.error.set('Could not create folder.');
    }
  }

  openRenameFolderModal(folder: DeckFolder): void {
    this.folderTarget.set(folder);
    this.renameFolderName = folder.name;
    this.folderRenameModalOpen.set(true);
  }

  closeFolderRenameModal(): void {
    this.folderRenameModalOpen.set(false);
    this.folderTarget.set(null);
    this.renameFolderName = '';
  }

  async renameFolder(): Promise<void> {
    const folder = this.folderTarget();
    const name = this.renameFolderName.trim();
    if (!folder || !name) {
      return;
    }

    try {
      const response = await firstValueFrom(this.deckFoldersApi.rename(folder.id, name));
      this.folders.set(this.folders().map((candidate) => candidate.id === folder.id ? response.folder : candidate));
      this.folderOptions.set(this.folderOptions().map((candidate) => candidate.id === folder.id ? response.folder : candidate));
      this.closeFolderRenameModal();
    } catch {
      this.error.set('Could not rename folder.');
    }
  }

  deleteFolder(folder: DeckFolder): void {
    this.folderTarget.set(folder);
    this.folderDeleteModalOpen.set(true);
  }

  async confirmDeleteFolder(): Promise<void> {
    const folder = this.folderTarget();
    if (!folder) {
      return;
    }

    try {
      await firstValueFrom(this.deckFoldersApi.delete(folder.id));
      this.folders.set(this.folders().filter((candidate) => candidate.id !== folder.id));
      this.folderOptions.set(this.folderOptions().filter((candidate) => candidate.id !== folder.id));
      this.decks.set(this.decks().map((deck) => deck.folderId === folder.id ? { ...deck, folderId: null } : deck));
      if (this.currentFolderId() === folder.id) {
        this.currentFolderId.set(null);
      }
      if (this.newDeckFolderId === folder.id) {
        this.newDeckFolderId = '';
      }
      this.folderDeleteModalOpen.set(false);
      this.folderTarget.set(null);
    } catch {
      this.error.set('Could not delete folder.');
    }
  }

  async create(): Promise<void> {
    const name = this.newDeckName.trim();
    if (!name) {
      return;
    }

    try {
      let deck = (await firstValueFrom(this.decksApi.create(name, this.newDeckFolderId || null))).deck;
      if (this.selectedCommander() && this.selectedFormat()?.hasCommander) {
        deck = (await firstValueFrom(this.decksApi.addCard(deck.id, {
          scryfallId: this.selectedCommander()!.scryfallId,
          section: 'commander',
        }))).deck;
      }
      this.createdDeck.set(deck);
      this.createdDecklist = '';
      this.createdMissing.set([]);
      this.createdImportMessage.set(null);
      this.decks.set([deck, ...this.decks()]);
      this.closeCreateModal();
      this.importModalOpen.set(true);
    } catch {
      this.error.set('Could not create deck.');
    }
  }

  closeImportModal(): void {
    const deck = this.createdDeck();
    this.importModalOpen.set(false);
    if (deck) {
      void this.router.navigate(['/decks', deck.id]);
    }
  }

  async importCreatedDeck(): Promise<void> {
    const deck = this.createdDeck();
    if (!deck || !this.createdDecklist.trim()) {
      return;
    }

    let entries: DecklistEntry[] = this.importExport.parse(this.createdDecklist, 'plain');

    try {
      let response = await firstValueFrom(this.decksApi.importDecklist(deck.id, this.importExport.toBackendDecklist(entries)));
      if (response.missing.length > 0) {
        const resolvedEntries = await this.importExport.resolveMissingFlavorNames(entries, response.missing);
        if (this.entriesChanged(entries, resolvedEntries)) {
          entries = resolvedEntries;
          response = await firstValueFrom(this.decksApi.importDecklist(deck.id, this.importExport.toBackendDecklist(entries)));
        }
      }
      const importedCards = (response.deck.cards ?? []).reduce((total, entry) => total + entry.quantity, 0);
      const parsedCards = entries.reduce((total, entry) => total + entry.quantity, 0);
      this.createdDeck.set(response.deck);
      this.createdMissing.set(response.missing);
      this.createdImportMessage.set(`${parsedCards} parsed cards, ${importedCards} imported, ${response.missing.length} missing.`);
      this.decks.set(this.decks().map((candidate) => candidate.id === response.deck.id ? response.deck : candidate));
    } catch {
      this.error.set('Could not import deck.');
    }
  }

  deleteDeck(deck: Deck): void {
    this.deleteTarget.set(deck);
    this.deleteModalOpen.set(true);
  }

  enterFolder(folderId: string): void {
    this.currentFolderId.set(folderId);
  }

  leaveFolder(): void {
    this.currentFolderId.set(null);
  }

  openDeck(id: string): void {
    void this.router.navigate(['/decks', id]);
  }

  folderDeckCount(folderId: string): number {
    return this.decks().filter((deck) => deck.folderId === folderId).length;
  }

  async moveDeck(deck: Deck, folderId: string): Promise<void> {
    const nextFolderId = folderId || null;
    if (deck.folderId === nextFolderId) {
      return;
    }

    try {
      const response = await firstValueFrom(this.decksApi.moveToFolder(deck.id, nextFolderId));
      this.decks.set(this.decks().map((candidate) => candidate.id === deck.id ? response.deck : candidate));
    } catch {
      this.error.set('Could not move deck.');
    }
  }

  async confirmDeleteDeck(): Promise<void> {
    const deck = this.deleteTarget();
    if (!deck) {
      return;
    }

    try {
      await firstValueFrom(this.decksApi.delete(deck.id));
      this.decks.set(this.decks().filter((candidate) => candidate.id !== deck.id));
      this.deleteModalOpen.set(false);
      this.deleteTarget.set(null);
    } catch {
      this.error.set('Could not delete deck.');
    }
  }

  deckFormatLabel(deck: Deck): string {
    return this.formats().find((format) => format.id === deck.format)?.name ?? deck.format;
  }

  selectedFormat(): DeckFormat | null {
    return this.formats().find((format) => format.id === this.newDeckFormatId) ?? null;
  }

  deckPrice(deck: Deck): string | null {
    const candidate = deck as Deck & {
      totalPriceUsd?: number | string | null;
      priceUsd?: number | string | null;
      totalPrice?: number | string | null;
      price?: { usd?: number | string | null } | number | string | null;
      prices?: { usd?: number | string | null };
    };
    const value =
      candidate.totalPriceUsd
      ?? candidate.priceUsd
      ?? candidate.totalPrice
      ?? (typeof candidate.price === 'object' && candidate.price ? candidate.price.usd : candidate.price)
      ?? candidate.prices?.usd;

    if (value === null || value === undefined || value === '') {
      return null;
    }

    return `$${value}`;
  }

  private entriesChanged(current: DecklistEntry[], next: DecklistEntry[]): boolean {
    return current.some((entry, index) => entry.name !== next[index]?.name);
  }

  private distinctCommanders(cards: Card[]): Card[] {
    const seen = new Set<string>();

    return cards.filter((card) => {
      const key = this.commanderDistinctKey(card);
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  private commanderDistinctKey(card: Card): string {
    return [
      card.name.trim().toLowerCase(),
      card.manaCost ?? '',
      card.typeLine ?? '',
      card.oracleText ?? '',
    ].join('|');
  }
}
