import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'app-dashboard-home',
  imports: [RouterLink, LucideAngularModule],
  template: `
    <section class="page-grid dashboard-grid">
      <a class="action-panel" routerLink="/cards">
        <lucide-icon name="credit-card" size="24" />
        <span>
          <strong>Search cards</strong>
          <small>Find Scryfall imports already synced in the backend.</small>
        </span>
      </a>
      <a class="action-panel" routerLink="/decks">
        <lucide-icon name="layers-3" size="24" />
        <span>
          <strong>Build decks</strong>
          <small>Import decklists, validate Commander legality, and choose a deck for rooms.</small>
        </span>
      </a>
      <a class="action-panel" routerLink="/rooms">
        <lucide-icon name="door-open" size="24" />
        <span>
          <strong>Join a room</strong>
          <small>Create or join by room id, then start a manual game table.</small>
        </span>
      </a>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardHomeComponent {}
