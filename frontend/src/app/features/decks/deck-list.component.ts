import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { DecksApi } from '../../core/api/decks.api';
import { Deck } from '../../core/models/deck.model';

@Component({
  selector: 'app-deck-list',
  imports: [FormsModule, RouterLink, LucideAngularModule],
  template: `
    <section class="page-stack">
      <div class="tool-header">
        <div>
          <span class="eyebrow">Decks</span>
          <h2>Commander decks</h2>
        </div>
        <form class="inline-form" (ngSubmit)="create()">
          <input name="name" placeholder="New deck name" required [(ngModel)]="newDeckName" />
          <button class="primary-button compact" type="submit">
            <lucide-icon name="plus" size="16" />
            Create
          </button>
          <button class="icon-button" type="button" title="Reload decks" (click)="load()">
            <lucide-icon name="refresh-ccw" size="16" />
          </button>
        </form>
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
          <a class="list-row" [routerLink]="['/decks', deck.id]">
            <span>
              <strong>{{ deck.name }}</strong>
              <small>{{ deck.format }}</small>
            </span>
            <span class="metric">{{ deck.cards?.length ?? 0 }} entries</span>
          </a>
        }
      </div>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeckListComponent {
  private readonly decksApi = inject(DecksApi);
  private readonly router = inject(Router);

  readonly decks = signal<Deck[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  newDeckName = '';

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
      await this.router.navigate(['/decks', response.deck.id]);
    } catch {
      this.error.set('Could not create deck.');
    }
  }
}
