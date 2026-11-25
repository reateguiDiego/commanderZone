import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  Navigation,
  NavigationCancel,
  NavigationStart,
  provideRouter,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { firstValueFrom, filter } from 'rxjs';
import { AppThemeAssetsService } from '../../../../../core/theme/app-theme-assets.service';
import { DeviceProfileService } from '../../../../../shared/services/device-profile.service';
import { DashboardHeaderComponent } from './dashboard-header.component';

@Component({
  standalone: true,
  template: '',
})
class RouteStubComponent {}

describe('DashboardHeaderComponent', () => {
  let fixture: ComponentFixture<DashboardHeaderComponent>;
  let router: Router;
  let resolveCards: (value: string) => void;
  let cardsReady: Promise<string>;
  let nextAnimationFrameId: number;
  let animationFrameCallbacks: Map<number, FrameRequestCallback>;

  beforeEach(async () => {
    nextAnimationFrameId = 0;
    animationFrameCallbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      nextAnimationFrameId += 1;
      animationFrameCallbacks.set(nextAnimationFrameId, callback);
      return nextAnimationFrameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (frameId: number): void => {
      animationFrameCallbacks.delete(frameId);
    });

    cardsReady = new Promise<string>((resolve) => {
      resolveCards = resolve;
    });

    await TestBed.configureTestingModule({
      imports: [DashboardHeaderComponent],
      providers: [
        provideRouter([
          { path: 'dashboard', component: RouteStubComponent },
          { path: 'admin', component: RouteStubComponent },
          { path: 'decks', component: RouteStubComponent },
          {
            path: 'cards',
            component: RouteStubComponent,
            resolve: { ready: () => cardsReady },
          },
          { path: 'blocked', component: RouteStubComponent, canActivate: [() => false] },
        ]),
        {
          provide: AppThemeAssetsService,
          useValue: { czLogoUrl: () => '' },
        },
        {
          provide: DeviceProfileService,
          useValue: { isDesktop: () => false, isDesktopLayout: () => false },
        },
      ],
    })
      .overrideComponent(DashboardHeaderComponent, {
        set: {
          imports: [RouterLink, RouterOutlet],
          template: `
            <nav #primaryNavigation>
              <span
                [style.width.px]="navigationIndicator().width"
                [style.height.px]="navigationIndicator().height"
                [style.transform]="
                  'translate3d(' +
                  navigationIndicator().x +
                  'px, ' +
                  navigationIndicator().y +
                  'px, 0)'
                "
              ></span>
              <a
                #navigationItem
                data-navigation-item="decks"
                routerLink="/decks"
                [class.active]="activeNavigationItem() === 'decks'"
                >Decks</a
              >
              <a
                #navigationItem
                data-navigation-item="cards"
                routerLink="/cards"
                [class.active]="activeNavigationItem() === 'cards'"
                >Cards</a
              >
            </nav>
            <router-outlet />
          `,
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(DashboardHeaderComponent);
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('selects the requested navigation item while the destination is still loading', async () => {
    mockNavigationLayout();

    await router.navigateByUrl('/decks');
    await flushAnimationFrames();
    fixture.detectChanges();

    const cardsNavigationStarted = firstValueFrom(
      router.events.pipe(filter((event) => event instanceof NavigationStart)),
    );
    const navigation = router.navigateByUrl('/cards');
    await cardsNavigationStarted;
    fixture.detectChanges();

    expect(activeNavigationLabel()).toBe('Cards');
    expect(fixture.componentInstance.navigationIndicator()).toMatchObject({
      x: 200,
      y: 4,
      width: 90,
      height: 40,
      visible: true,
    });

    resolveCards('ready');
    await navigation;
    fixture.detectChanges();

    expect(activeNavigationLabel()).toBe('Cards');
  });

  it('initializes a newly mounted header from the destination of the in-flight navigation', async () => {
    await router.navigateByUrl('/decks');
    const destinationUrl = router.parseUrl('/cards');
    const currentNavigationSpy = vi.spyOn(router, 'getCurrentNavigation').mockReturnValue({
      id: 2,
      initialUrl: destinationUrl,
      finalUrl: destinationUrl,
    } as Navigation);

    const recreatedFixture = TestBed.createComponent(DashboardHeaderComponent);
    recreatedFixture.detectChanges();

    expect(recreatedFixture.componentInstance.activeNavigationItem()).toBe('cards');
    const cardsLink = recreatedFixture.nativeElement.querySelector(
      '[data-navigation-item="cards"]',
    ) as HTMLAnchorElement;
    expect(cardsLink.classList.contains('active')).toBe(true);
    currentNavigationSpy.mockRestore();
  });

  it('slides in from outside the left edge when navigating from Home', async () => {
    await router.navigateByUrl('/dashboard');
    await flushAnimationFrames();
    mockNavigationLayout();

    const navigationStarted = firstValueFrom(
      router.events.pipe(filter((event) => event instanceof NavigationStart)),
    );
    const navigation = router.navigateByUrl('/decks');
    await navigationStarted;
    await nextAnimationFrame();

    expect(fixture.componentInstance.navigationIndicator()).toMatchObject({
      x: -92,
      width: 80,
      visible: true,
    });

    await nextAnimationFrame();
    await navigation;

    expect(fixture.componentInstance.navigationIndicator()).toMatchObject({ x: 20, visible: true });
  });

  it('slides from the first navigation option across the menu when navigating from Admin', async () => {
    await router.navigateByUrl('/admin');
    await flushAnimationFrames();
    mockNavigationLayout();

    const navigationStarted = firstValueFrom(
      router.events.pipe(filter((event) => event instanceof NavigationStart)),
    );
    const navigation = router.navigateByUrl('/cards');
    await navigationStarted;
    await nextAnimationFrame();

    expect(fixture.componentInstance.navigationIndicator()).toMatchObject({
      x: 20,
      width: 80,
      visible: true,
    });

    await nextAnimationFrame();
    expect(fixture.componentInstance.navigationIndicator()).toMatchObject({
      x: 200,
      width: 90,
      visible: true,
    });

    resolveCards('ready');
    await navigation;
  });

  it('restores the current navigation item when navigation is canceled', async () => {
    await router.navigateByUrl('/decks');
    fixture.detectChanges();

    const navigationCanceled = firstValueFrom(
      router.events.pipe(filter((event) => event instanceof NavigationCancel)),
    );
    await router.navigateByUrl('/blocked');
    await navigationCanceled;
    fixture.detectChanges();

    expect(activeNavigationLabel()).toBe('Decks');
  });

  function activeNavigationLabel(): string | null {
    const activeLink = fixture.nativeElement.querySelector('a.active') as HTMLAnchorElement | null;
    return activeLink?.textContent?.trim() ?? null;
  }

  async function flushAnimationFrames(): Promise<void> {
    while (animationFrameCallbacks.size > 0) {
      await nextAnimationFrame();
    }
  }

  async function nextAnimationFrame(): Promise<void> {
    const callbacks = [...animationFrameCallbacks.values()];
    animationFrameCallbacks.clear();
    callbacks.forEach((callback) => callback(0));
  }

  function mockNavigationLayout(): void {
    const navigationElement = fixture.nativeElement.querySelector('nav') as HTMLElement;
    const decksLink = fixture.nativeElement.querySelector(
      '[data-navigation-item="decks"]',
    ) as HTMLAnchorElement;
    const cardsLink = fixture.nativeElement.querySelector(
      '[data-navigation-item="cards"]',
    ) as HTMLAnchorElement;
    vi.spyOn(navigationElement, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(10, 20, 500, 48),
    );
    vi.spyOn(decksLink, 'getBoundingClientRect').mockReturnValue(new DOMRect(30, 24, 80, 40));
    vi.spyOn(cardsLink, 'getBoundingClientRect').mockReturnValue(new DOMRect(210, 24, 90, 40));
  }
});
