import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';
import { AuthPageComponent } from './features/auth/auth-page.component';
import { CardDetailComponent } from './features/cards/card-detail.component';
import { CardSearchComponent } from './features/cards/card-search.component';
import { DashboardHomeComponent } from './features/dashboard/dashboard-home.component';
import { DashboardShellComponent } from './features/dashboard/dashboard-shell.component';
import { DeckEditorComponent } from './features/decks/deck-editor.component';
import { DeckListComponent } from './features/decks/deck-list.component';
import { GameTableComponent } from './features/game/game-table.component';
import { RoomsComponent } from './features/rooms/rooms.component';

export const routes: Routes = [
  {
    path: 'auth/login',
    component: AuthPageComponent,
    canActivate: [guestGuard],
  },
  {
    path: '',
    component: DashboardShellComponent,
    canActivate: [authGuard],
    children: [
      { path: 'dashboard', component: DashboardHomeComponent },
      { path: 'cards', component: CardSearchComponent },
      { path: 'cards/:scryfallId', component: CardDetailComponent },
      { path: 'decks', component: DeckListComponent },
      { path: 'decks/:id', component: DeckEditorComponent },
      { path: 'rooms', component: RoomsComponent },
      { path: 'games/:id', component: GameTableComponent },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
