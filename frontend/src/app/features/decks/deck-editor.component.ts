import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { DecksApi } from '../../core/api/decks.api';
import { CommanderValidation, Deck, DeckCard, DeckSection } from '../../core/models/deck.model';

@Component({
  selector: 'app-deck-editor',
  imports: [FormsModule, RouterLink, LucideAngularModule],
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
          <div class="button-row">
            <button class="icon-button danger" type="button" title="Delete deck" (click)="deleteDeck(deck.id)">
              <lucide-icon name="trash-2" size="17" />
            </button>
          </div>
        </div>

        <div class="editor-layout">
          <section class="panel form-stack">
            <label>
              Deck name
              <input name="deckName" [(ngModel)]="deckName" />
            </label>
            <button class="primary-button" type="button" (click)="rename(deck.id)">
              <lucide-icon name="save" size="17" />
              Save name
            </button>

            <label>
              Import decklist
              <textarea name="decklist" rows="12" placeholder="1 Sol Ring&#10;1 Command Tower" [(ngModel)]="decklist"></textarea>
            </label>
            <button class="secondary-button" type="button" (click)="importDeck(deck.id)">
              <lucide-icon name="upload" size="17" />
              Import list
            </button>

            @if (missing().length > 0) {
              <div class="notice warning">
                <strong>Missing cards</strong>
                <span>{{ missing().join(', ') }}</span>
              </div>
            }

            <button class="secondary-button" type="button" (click)="validate(deck.id)">
              <lucide-icon name="check-circle-2" size="17" />
              Validate Commander
            </button>

            @if (validation(); as result) {
              <div class="notice" [class.ok-notice]="result.valid" [class.error]="!result.valid">
                <strong>{{ result.valid ? 'Commander legal' : 'Commander issues' }}</strong>
                @if (!result.valid) {
                  <ul>
                    @for (message of result.errors; track message) {
                      <li>{{ message }}</li>
                    }
                  </ul>
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
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckEditorComponent {
  private readonly decksApi = inject(DecksApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly deck = signal<Deck | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly missing = signal<string[]>([]);
  readonly validation = signal<CommanderValidation | null>(null);
  readonly mainCards = computed(() => this.cardsBySection('main'));
  readonly commanderCards = computed(() => this.cardsBySection('commander'));
  readonly totalCards = computed(() => (this.deck()?.cards ?? []).reduce((total, entry) => total + entry.quantity, 0));

  deckName = '';
  decklist = '';

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
    } catch {
      this.error.set('Could not load deck.');
    } finally {
      this.loading.set(false);
    }
  }

  async rename(id: string): Promise<void> {
    const response = await firstValueFrom(this.decksApi.rename(id, this.deckName.trim()));
    this.deck.set(response.deck);
    this.deckName = response.deck.name;
  }

  async importDeck(id: string): Promise<void> {
    const response = await firstValueFrom(this.decksApi.importDecklist(id, this.decklist));
    this.deck.set(response.deck);
    this.missing.set(response.missing);
    this.validation.set(null);
  }

  async validate(id: string): Promise<void> {
    const response = await firstValueFrom(this.decksApi.validateCommander(id));
    this.validation.set(response);
  }

  async deleteDeck(id: string): Promise<void> {
    if (!window.confirm('Delete this deck?')) {
      return;
    }

    await firstValueFrom(this.decksApi.delete(id));
    await this.router.navigate(['/decks']);
  }

  private cardsBySection(section: DeckSection): DeckCard[] {
    return (this.deck()?.cards ?? []).filter((entry) => entry.section === section);
  }
}
