import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { DecksApi } from '../../core/api/decks.api';
import { Deck } from '../../core/models/deck.model';
import { AppModalComponent } from '../../shared/ui/app-modal.component';
import { DeckImportExportService, DecklistEntry } from './deck-import-export.service';

@Component({
  selector: 'app-deck-list',
  imports: [FormsModule, RouterLink, LucideAngularModule, AppModalComponent],
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
            Create
          </button>
          <button class="icon-button" type="button" title="Reload decks" (click)="load()">
            <lucide-icon name="refresh-ccw" size="16" />
          </button>
        </div>
      </div>

      @if (loading()) {
        <p class="notice">Loading decks...</p>
      } @else if (error()) {
        <p class="notice error">{{ error() }}</p>
      } @else if (decks().length === 0) {
        <p class="notice">No decks yet. Create one and import a decklist.</p>
      }

      <div class="dense-list">
        @for (deck of decks(); track deck.id) {
          <div class="list-row deck-list-row">
            <a class="deck-link" [routerLink]="['/decks', deck.id]">
              <span>
                <strong>{{ deck.name }}</strong>
                <small>{{ deck.format }}</small>
              </span>
            </a>
            <button class="icon-button danger" type="button" title="Delete deck" (click)="deleteDeck(deck)">
              <lucide-icon name="trash-2" size="16" />
            </button>
          </div>
        }
      </div>

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
            <select name="format" [(ngModel)]="newDeckFormat">
              <option value="commander">Commander</option>
            </select>
          </label>
          <label>
            Folder
            <select name="folder" [(ngModel)]="newDeckFolder">
              <option value="folder-1">Folder 1</option>
              <option value="folder-2">Folder 2</option>
              <option value="folder-3">Folder 3</option>
            </select>
          </label>
        </div>
      </app-modal>

      <app-modal
        [open]="importModalOpen()"
        [title]="createdDeck() ? 'Import decklist' : 'Import decklist'"
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
        [message]="deleteTarget() ? 'Delete ' + deleteTarget()?.name + '?' : ''"
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
  private readonly router = inject(Router);
  private readonly importExport = inject(DeckImportExportService);

  readonly decks = signal<Deck[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly createModalOpen = signal(false);
  readonly importModalOpen = signal(false);
  readonly deleteModalOpen = signal(false);
  readonly deleteTarget = signal<Deck | null>(null);
  readonly createdDeck = signal<Deck | null>(null);
  readonly createdMissing = signal<string[]>([]);
  readonly createdImportMessage = signal<string | null>(null);
  newDeckName = '';
  newDeckFormat = 'commander';
  newDeckFolder = 'folder-1';
  createdDecklist = '';

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const response = await firstValueFrom(this.decksApi.list());
      this.decks.set(response.data);
    } catch {
      this.error.set('Could not load decks.');
    } finally {
      this.loading.set(false);
    }
  }

  async create(): Promise<void> {
    const name = this.newDeckName.trim();
    if (!name) {
      return;
    }

    try {
      const response = await firstValueFrom(this.decksApi.create(name));
      this.newDeckName = '';
      this.createModalOpen.set(false);
      this.createdDeck.set(response.deck);
      this.createdDecklist = '';
      this.createdMissing.set([]);
      this.createdImportMessage.set(null);
      this.decks.set([response.deck, ...this.decks()]);
      this.importModalOpen.set(true);
    } catch {
      this.error.set('Could not create deck.');
    }
  }

  openCreateModal(): void {
    this.createModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.newDeckName = '';
    this.newDeckFormat = 'commander';
    this.newDeckFolder = 'folder-1';
    this.createModalOpen.set(false);
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

    const entries: DecklistEntry[] = this.importExport.parse(this.createdDecklist, 'plain');
    const decklist = this.importExport.toBackendDecklist(entries);

    try {
      const response = await firstValueFrom(this.decksApi.importDecklist(deck.id, decklist));
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
}
