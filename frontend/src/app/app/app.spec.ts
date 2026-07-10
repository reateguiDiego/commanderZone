import { Component, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { AuthStore } from '../core/auth/auth.store';
import { LoadingStore } from '../core/loading/loading.store';
import { RuntimeLanguageSelectorService } from '../core/localization/runtime-language-selector.service';
import { NotFoundNavigationService } from '../core/routing/not-found-navigation.service';
import { App } from './app';

@Component({
  template: '',
})
class EmptyRouteComponent {}

describe('App', () => {
  const authStore = {
    initialize: vi.fn().mockResolvedValue(undefined),
  };
  let resolveSlowNavigation: ((value: boolean) => void) | null = null;

  beforeEach(async () => {
    localStorage.clear();
    window.history.pushState({}, '', '/');
    document.body.classList.remove('dashboard-background');
    document.documentElement.style.removeProperty('--app-session-background');
    authStore.initialize.mockClear();
    resolveSlowNavigation = null;

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        { provide: AuthStore, useValue: authStore },
        { provide: RuntimeLanguageSelectorService, useValue: {} },
        provideRouter([
          { path: '', pathMatch: 'full', component: EmptyRouteComponent },
          { path: 'en/faq', component: EmptyRouteComponent },
          { path: 'en/play-commander-online', component: EmptyRouteComponent },
          { path: 'auth/login', component: EmptyRouteComponent },
          { path: 'auth/register', component: EmptyRouteComponent },
          { path: 'admin', component: EmptyRouteComponent },
          { path: 'cards', component: EmptyRouteComponent },
          { path: 'community', component: EmptyRouteComponent },
          { path: 'contact', component: EmptyRouteComponent },
          { path: 'dashboard', component: EmptyRouteComponent },
          { path: 'decks', component: EmptyRouteComponent },
          {
            path: 'slow-route',
            component: EmptyRouteComponent,
            canActivate: [() => new Promise<boolean>((resolve) => { resolveSlowNavigation = resolve; })],
          },
          { path: 'table-assistant', component: EmptyRouteComponent },
          { path: 'table-assistant/:id', component: EmptyRouteComponent },
          { path: 'games/:id', component: EmptyRouteComponent },
          {
            path: 'games/:id/slow',
            component: EmptyRouteComponent,
            canActivate: [() => new Promise<boolean>((resolve) => { resolveSlowNavigation = resolve; })],
          },
          { path: '**', component: EmptyRouteComponent },
        ]),
      ],
    }).compileComponents();
  });

  it('initializes auth in the browser', () => {
    TestBed.createComponent(App);

    expect(authStore.initialize).toHaveBeenCalledOnce();
  });

  it('does not initialize auth during server rendering', async () => {
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        { provide: AuthStore, useValue: authStore },
        { provide: RuntimeLanguageSelectorService, useValue: {} },
        { provide: PLATFORM_ID, useValue: 'server' },
        provideRouter([]),
      ],
    }).compileComponents();

    authStore.initialize.mockClear();
    TestBed.createComponent(App);

    expect(authStore.initialize).not.toHaveBeenCalled();
  });

  it('replaces the public footer disclaimer with the long noindex disclaimer on app noindex routes', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/dashboard');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-noindex-footer-disclaimer')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.app-noindex-disclaimer')?.textContent).toContain('CommanderZone is unofficial Fan Content');

    await router.navigateByUrl('/admin');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-noindex-footer-disclaimer')).toBeNull();

    await router.navigateByUrl('/decks');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-noindex-footer-disclaimer')).not.toBeNull();

    await router.navigateByUrl('/community');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-footer-disclaimer')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-noindex-footer-disclaimer')).toBeNull();

    await router.navigateByUrl('/table-assistant');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('.app-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-noindex-footer-disclaimer')).not.toBeNull();

    await router.navigateByUrl('/table-assistant/room-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('.app-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-noindex-footer-disclaimer')).toBeNull();

    await router.navigateByUrl('/games/game-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('.app-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-noindex-footer-disclaimer')).toBeNull();
  });

  it('hides both footer disclaimers on auth entry routes', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/auth/login');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('.app-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-noindex-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('.app-noindex-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('.app-route-frame-with-noindex-disclaimer')).toBeNull();

    await router.navigateByUrl('/auth/register');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('.app-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-noindex-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('.app-noindex-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('.app-route-frame-with-noindex-disclaimer')).toBeNull();
  });

  it('records the previous route before wildcard not-found navigation', async () => {
    const router = TestBed.inject(Router);
    const notFoundNavigation = TestBed.inject(NotFoundNavigationService);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/community');
    await router.navigateByUrl('/missing-route');
    fixture.detectChanges();

    expect(notFoundNavigation.returnUrl()).toBe('/community');
  });

  it('applies global loading visibility by route ownership', async () => {
    const router = TestBed.inject(Router);
    const loading = TestBed.inject(LoadingStore);
    const fixture = TestBed.createComponent(App);

    loading.start();

    await router.navigateByUrl('/');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.global-loader')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-footer-disclaimer')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-noindex-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('.app-route-frame-with-noindex-disclaimer')).toBeNull();

    await router.navigateByUrl('/en/play-commander-online');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.global-loader')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-footer-disclaimer')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-noindex-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('.app-route-frame-with-noindex-disclaimer')).toBeNull();

    await router.navigateByUrl('/dashboard');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.global-loader')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-noindex-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('.app-route-frame-with-noindex-disclaimer')).toBeNull();

    await router.navigateByUrl('/games/game-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.global-loader')).toBeNull();

    loading.stop();
  });

  it('shows only the global loader during initial app route loading', () => {
    window.history.pushState({}, '', '/dashboard');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.global-loader')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-noindex-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('.app-route-frame-with-noindex-disclaimer')).toBeNull();
  });

  it('shows the global loader while an app route navigation is pending', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await router.navigateByUrl('/');

    const navigation = router.navigateByUrl('/slow-route');
    await vi.waitFor(() => expect(resolveSlowNavigation).toBeTypeOf('function'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.global-loader')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-noindex-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('.app-route-frame-with-noindex-disclaimer')).toBeNull();

    resolveSlowNavigation?.(true);
    await navigation;
  });

  it('shows the global loader while navigating to a feature with local request loading', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await router.navigateByUrl('/');

    const navigation = router.navigateByUrl('/games/game-1/slow');
    await vi.waitFor(() => expect(resolveSlowNavigation).toBeTypeOf('function'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.global-loader')).not.toBeNull();

    resolveSlowNavigation?.(true);
    await navigation;
  });

  it('toggles dashboard background mode and only applies a session background on private shell routes', async () => {
    const router = TestBed.inject(Router);
    TestBed.createComponent(App);

    await router.navigateByUrl('/');
    expect(document.body.classList.contains('dashboard-background')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--app-session-background')).toBe('');

    await router.navigateByUrl('/dashboard');
    expect(document.body.classList.contains('dashboard-background')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--app-session-background'))
      .toMatch(/^url\("\/assets\/images\/backgrounds\/sunrise\/bg-\d+\.webp"\)$/);

    await router.navigateByUrl('/contact');
    expect(document.body.classList.contains('dashboard-background')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--app-session-background')).toBe('');

    await router.navigateByUrl('/dashboard');
    expect(document.body.classList.contains('dashboard-background')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--app-session-background'))
      .toMatch(/^url\("\/assets\/images\/backgrounds\/sunrise\/bg-\d+\.webp"\)$/);

    await router.navigateByUrl('/en/play-commander-online');
    expect(document.body.classList.contains('dashboard-background')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--app-session-background')).toBe('');
  });
});
