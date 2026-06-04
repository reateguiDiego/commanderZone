import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';
import { SEO_LANDING_ROUTES } from './features/seo-landings/seo-landing.routes';
import { LEGAL_ROUTES } from './features/legal/legal.routes';

export const routes: Routes = [
  ...SEO_LANDING_ROUTES,
  ...LEGAL_ROUTES,
  {
    path: 'welcome',
    loadComponent: () => import('./features/onboarding/onboarding-page/onboarding-page.component')
      .then((component) => component.OnboardingPageComponent),
    canActivate: [guestGuard],
    data: { pageKey: 'app' },
    title: 'CommanderZone',
  },
  {
    path: 'room/:id',
    loadComponent: () => import('./features/onboarding/demo-room-page/demo-room-page.component')
      .then((component) => component.DemoRoomPageComponent),
    data: { pageKey: 'demoRoom' },
    title: 'CommanderZone',
  },
  {
    path: 'auth/login',
    loadComponent: () => import('./features/auth/auth-page/auth-page.component')
      .then((component) => component.AuthPageComponent),
    canActivate: [guestGuard],
    data: { pageKey: 'login' },
    title: 'Login | CommanderZone',
  },
  {
    path: 'auth/register',
    loadComponent: () => import('./features/auth/auth-page/auth-page.component')
      .then((component) => component.AuthPageComponent),
    canActivate: [guestGuard],
    data: { pageKey: 'register' },
    title: 'Sign up | CommanderZone',
  },
  {
    path: 'auth/password-reset',
    loadComponent: () => import('./features/auth/password-reset-page/password-reset-page.component')
      .then((component) => component.PasswordResetPageComponent),
    canActivate: [guestGuard],
    data: { pageKey: 'passwordReset' },
  },
  {
    path: 'email-verification',
    loadComponent: () => import('./features/auth/email-verification-page/email-verification-page.component')
      .then((component) => component.EmailVerificationPageComponent),
    data: { pageKey: 'emailVerification' },
  },
  {
    path: 'games/:id/debug',
    loadComponent: () => import('./features/game/game-debug/game-debug-page.component')
      .then((component) => component.GameDebugPageComponent),
    canActivate: [authGuard],
    data: { pageKey: 'gameDebug' },
    title: 'CommanderZone Debug',
  },
  {
    path: 'games/:id',
    loadComponent: () => import('./features/game/game-table/game-table.component')
      .then((component) => component.GameTableComponent),
    canActivate: [authGuard],
    data: { pageKey: 'game' },
    title: 'CommanderZone',
  },
  {
    path: '',
    loadComponent: () => import('./features/dashboard/dashboard-shell/dashboard-shell.component')
      .then((component) => component.DashboardShellComponent),
    canActivate: [authGuard],
    data: { pageKey: 'app' },
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard-home/dashboard-home.component')
          .then((component) => component.DashboardHomeComponent),
        data: { pageKey: 'dashboard' },
      },
      {
        path: 'cards',
        loadComponent: () => import('./features/cards/card-search/card-search.component')
          .then((component) => component.CardSearchComponent),
        data: { pageKey: 'cards' },
      },
      {
        path: 'cards/:scryfallId',
        loadComponent: () => import('./features/cards/card-detail/card-detail.component')
          .then((component) => component.CardDetailComponent),
        data: { pageKey: 'cardDetail' },
      },
      {
        path: 'decks',
        loadComponent: () => import('./features/decks/deck-list/deck-list.component')
          .then((component) => component.DeckListComponent),
        data: { pageKey: 'decks' },
      },
      {
        path: 'decks/:id',
        loadComponent: () => import('./features/decks/deck-editor/deck-editor.component')
          .then((component) => component.DeckEditorComponent),
        data: { pageKey: 'deckEditor' },
      },
      {
        path: 'rooms',
        loadComponent: () => import('./features/rooms/rooms/rooms.component')
          .then((component) => component.RoomsComponent),
        data: { pageKey: 'rooms' },
      },
      {
        path: 'rooms/:id/waiting',
        loadComponent: () => import('./features/rooms/waiting-room/waiting-room.component')
          .then((component) => component.WaitingRoomComponent),
        data: { pageKey: 'waitingRoom' },
      },
      {
        path: 'table-assistant',
        loadComponent: () => import('./features/table-assistant/table-assistant-page/table-assistant-page.component')
          .then((component) => component.TableAssistantPageComponent),
        data: { pageKey: 'tableAssistantApp' },
      },
      {
        path: 'table-assistant/:id',
        loadComponent: () => import('./features/table-assistant/table-assistant-room/table-assistant-room.component')
          .then((component) => component.TableAssistantRoomComponent),
        data: { pageKey: 'tableAssistantApp' },
      },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard', data: { pageKey: 'dashboard' } },
    ],
  },
  {
    path: '**',
    loadComponent: () => import('./features/not-found/not-found-page/not-found-page.component')
      .then((component) => component.NotFoundPageComponent),
    data: { pageKey: 'wildcardRedirect' },
  },
];
