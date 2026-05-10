import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/onboarding/onboarding-page/onboarding-page.component')
      .then((component) => component.OnboardingPageComponent),
    pathMatch: 'full',
    title: 'Play Commander online in seconds',
  },
  {
    path: 'room/:id',
    loadComponent: () => import('./features/onboarding/demo-room-page/demo-room-page.component')
      .then((component) => component.DemoRoomPageComponent),
    title: 'Commander room',
  },
  {
    path: 'auth/login',
    loadComponent: () => import('./features/auth/auth-page/auth-page.component')
      .then((component) => component.AuthPageComponent),
    canActivate: [guestGuard],
  },
  {
    path: 'auth/register',
    loadComponent: () => import('./features/auth/auth-page/auth-page.component')
      .then((component) => component.AuthPageComponent),
    canActivate: [guestGuard],
  },
  {
    path: 'auth/password-reset',
    loadComponent: () => import('./features/auth/password-reset-page/password-reset-page.component')
      .then((component) => component.PasswordResetPageComponent),
    canActivate: [guestGuard],
  },
  {
    path: 'games/:id',
    loadComponent: () => import('./features/game/game-table/game-table.component')
      .then((component) => component.GameTableComponent),
    canActivate: [authGuard],
    title: 'Game table',
  },
  {
    path: '',
    loadComponent: () => import('./features/dashboard/dashboard-shell/dashboard-shell.component')
      .then((component) => component.DashboardShellComponent),
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard-home/dashboard-home.component')
          .then((component) => component.DashboardHomeComponent),
      },
      {
        path: 'cards',
        loadComponent: () => import('./features/cards/card-search/card-search.component')
          .then((component) => component.CardSearchComponent),
      },
      {
        path: 'cards/:scryfallId',
        loadComponent: () => import('./features/cards/card-detail/card-detail.component')
          .then((component) => component.CardDetailComponent),
      },
      {
        path: 'decks',
        loadComponent: () => import('./features/decks/deck-list/deck-list.component')
          .then((component) => component.DeckListComponent),
      },
      {
        path: 'decks/:id',
        loadComponent: () => import('./features/decks/deck-editor/deck-editor.component')
          .then((component) => component.DeckEditorComponent),
      },
      {
        path: 'rooms',
        loadComponent: () => import('./features/rooms/rooms/rooms.component')
          .then((component) => component.RoomsComponent),
      },
      {
        path: 'rooms/:id/waiting',
        loadComponent: () => import('./features/rooms/waiting-room/waiting-room.component')
          .then((component) => component.WaitingRoomComponent),
      },
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
