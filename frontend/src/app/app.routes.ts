import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';
import { AuthPageComponent } from './features/auth/auth-page/auth-page.component';
import { PasswordResetPageComponent } from './features/auth/password-reset-page/password-reset-page.component';
import { CardDetailComponent } from './features/cards/card-detail/card-detail.component';
import { CardSearchComponent } from './features/cards/card-search/card-search.component';
import { DashboardHomeComponent } from './features/dashboard/dashboard-home/dashboard-home.component';
import { DashboardShellComponent } from './features/dashboard/dashboard-shell/dashboard-shell.component';
import { DeckEditorComponent } from './features/decks/deck-editor/deck-editor.component';
import { DeckListComponent } from './features/decks/deck-list/deck-list.component';
import { GameTableComponent } from './features/game/game-table/game-table.component';
import { DemoRoomPageComponent } from './features/onboarding/demo-room-page/demo-room-page.component';
import { OnboardingPageComponent } from './features/onboarding/onboarding-page/onboarding-page.component';
import { RoomsComponent } from './features/rooms/rooms/rooms.component';
import { WaitingRoomComponent } from './features/rooms/waiting-room/waiting-room.component';

export const routes: Routes = [
  {
    path: '',
    component: OnboardingPageComponent,
    pathMatch: 'full',
    title: 'Play Commander online in seconds',
  },
  {
    path: 'room/:id',
    component: DemoRoomPageComponent,
    title: 'Commander room',
  },
  {
    path: 'auth/login',
    component: AuthPageComponent,
    canActivate: [guestGuard],
  },
  {
    path: 'auth/register',
    component: AuthPageComponent,
    canActivate: [guestGuard],
  },
  {
    path: 'auth/password-reset',
    component: PasswordResetPageComponent,
    canActivate: [guestGuard],
  },
  {
    path: 'games/:id',
    component: GameTableComponent,
    canActivate: [authGuard],
    title: 'Game table',
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
      { path: 'rooms/:id/waiting', component: WaitingRoomComponent },
      {
        path: 'table-assistant',
        loadComponent: () => import('./features/table-assistant/table-assistant-page/table-assistant-page.component')
          .then((component) => component.TableAssistantPageComponent),
      },
      {
        path: 'table-assistant/:id',
        loadComponent: () => import('./features/table-assistant/table-assistant-room/table-assistant-room.component')
          .then((component) => component.TableAssistantRoomComponent),
      },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
