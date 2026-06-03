import { Component, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { AuthStore } from '../core/auth/auth.store';
import { RuntimeLanguageSelectorService } from '../core/localization/runtime-language-selector.service';
import { App } from './app';

@Component({
  template: '',
})
class EmptyRouteComponent {}

describe('App', () => {
  const authStore = {
    initialize: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    localStorage.clear();
    authStore.initialize.mockClear();

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        { provide: AuthStore, useValue: authStore },
        provideRouter([
          { path: 'table-assistant', component: EmptyRouteComponent },
          { path: 'table-assistant/:id', component: EmptyRouteComponent },
          { path: 'games/:id', component: EmptyRouteComponent },
        ]),
        {
          provide: RuntimeLanguageSelectorService,
          useValue: {},
        },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
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
        { provide: PLATFORM_ID, useValue: 'server' },
        provideRouter([]),
        {
          provide: RuntimeLanguageSelectorService,
          useValue: {},
        },
      ],
    }).compileComponents();

    authStore.initialize.mockClear();
    TestBed.createComponent(App);

    expect(authStore.initialize).not.toHaveBeenCalled();
  });

  it('should render the router outlet host', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });

  it('renders cookie consent after the routed content host', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const routerOutlet = compiled.querySelector('router-outlet');
    const cookieBanner = compiled.querySelector('app-cookie-consent-banner');

    expect(cookieBanner).not.toBeNull();
    expect(routerOutlet?.compareDocumentPosition(cookieBanner as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('keeps the global disclaimer on the table assistant setup page', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/table-assistant');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-footer-disclaimer')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.app-disclaimer')).not.toBeNull();
  });

  it('hides the global disclaimer inside a table assistant room', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/table-assistant/room-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('.app-disclaimer')).toBeNull();
  });

  it('hides the global disclaimer inside a game table', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/games/game-1');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-footer-disclaimer')).toBeNull();
    expect(fixture.nativeElement.querySelector('.app-disclaimer')).toBeNull();
  });
});
