import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnDestroy,
  QueryList,
  ViewChild,
  ViewChildren,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterLink,
} from '@angular/router';
import { FriendRemovalRequest } from '../../../../friends/friends-dropdown/friends-dropdown.component';
import { UserAvatar, UserDisplayNameStyle } from '../../../../../core/models/user.model';
import { RuntimeTranslatePipe } from '../../../../../core/localization/runtime-translate.pipe';
import { AppThemeAssetsService } from '../../../../../core/theme/app-theme-assets.service';
import { DeviceProfileService } from '../../../../../shared/services/device-profile.service';
import { DashboardHeaderControlsComponent } from '../dashboard-header-controls/dashboard-header-controls.component';
type DashboardNavigationItem = 'decks' | 'rooms' | 'cards' | 'community' | 'table-assistant';

interface NavigationIndicatorGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface NavigationIndicatorPosition extends NavigationIndicatorGeometry {
  readonly visible: boolean;
}

@Component({
  selector: 'app-dashboard-header',
  imports: [RuntimeTranslatePipe, RouterLink, DashboardHeaderControlsComponent],
  templateUrl: './dashboard-header.component.html',
  styleUrl: './dashboard-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardHeaderComponent implements AfterViewInit, OnDestroy {
  readonly themeAssets = inject(AppThemeAssetsService);
  readonly device = inject(DeviceProfileService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  @ViewChild('primaryNavigation', { read: ElementRef })
  private primaryNavigation?: ElementRef<HTMLElement>;
  @ViewChild('activeNavigationIndicator', { read: ElementRef })
  private activeNavigationIndicator?: ElementRef<HTMLElement>;
  @ViewChildren('navigationItem', { read: ElementRef })
  private navigationItems!: QueryList<ElementRef<HTMLAnchorElement>>;
  private navigationResizeObserver: ResizeObserver | null = null;
  private observedNavigationItem: HTMLAnchorElement | null = null;
  private initialPositionFrame: number | null = null;
  private motionEnableFrame: number | null = null;
  private stagingNavigationIndicator = false;
  private latestNavigationId = 0;
  readonly activeNavigationItem = signal<DashboardNavigationItem | null>(
    this.navigationItemForUrl(this.initialNavigationUrl()),
  );
  readonly navigationIndicator = signal<NavigationIndicatorPosition>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    visible: false,
  });
  readonly navigationIndicatorMotionEnabled = signal(false);
  readonly navigationIndicatorEnteringFromLeft = signal(false);
  private hasInitialNavigationPosition = false;
  readonly userLabel = input('Player');
  readonly userAvatar = input<UserAvatar | null | undefined>(null);
  readonly userNameStyle = input<UserDisplayNameStyle | null | undefined>(null);
  readonly friendsOpen = input(false);
  readonly messagesOpen = input(false);
  readonly pendingNotificationsCount = input(0);
  readonly onlineFriendsCount = input(0);
  readonly messagesCount = input(0);
  readonly unreadMessagesCount = input(0);
  readonly canAccessAdmin = input(false);
  readonly canModerate = input(false);
  readonly pendingModerationReportsCount = input(0);
  readonly pendingModerationReportsBadgeLabel = input('0');
  readonly showPendingModerationReportsBadge = input(true);
  readonly authenticated = input(false);
  readonly toggleFriends = output<MouseEvent>();
  readonly toggleMessages = output<MouseEvent>();
  readonly closeFriends = output<void>();
  readonly closeMessages = output<void>();
  readonly logout = output<void>();
  readonly friendRemovalRequested = output<FriendRemovalRequest>();

  constructor() {
    this.latestNavigationId = this.router.getCurrentNavigation()?.id ?? 0;
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.latestNavigationId = event.id;
        const targetItem = this.navigationItemForUrl(event.url);
        this.setActiveNavigationItem(targetItem);
        return;
      }

      if (event instanceof NavigationEnd) {
        if (event.id !== this.latestNavigationId) return;
        this.setActiveNavigationItem(this.navigationItemForUrl(event.urlAfterRedirects));
        return;
      }

      if (event instanceof NavigationCancel || event instanceof NavigationError) {
        if (event.id !== this.latestNavigationId) return;
        this.setActiveNavigationItem(this.navigationItemForUrl(this.router.url));
      }
    });
  }

  ngAfterViewInit(): void {
    this.navigationItems.changes.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.updateNavigationIndicator();
    });

    if (typeof ResizeObserver !== 'undefined') {
      this.navigationResizeObserver = new ResizeObserver(() => this.updateNavigationIndicator());
      const navigation = this.primaryNavigation?.nativeElement;
      if (navigation) this.navigationResizeObserver.observe(navigation);
    }

    if (typeof requestAnimationFrame === 'function') {
      this.initialPositionFrame = requestAnimationFrame(() => {
        this.initialPositionFrame = null;
        this.updateNavigationIndicator();
        this.hasInitialNavigationPosition = true;
        this.motionEnableFrame = requestAnimationFrame(() => {
          this.motionEnableFrame = null;
          this.navigationIndicatorMotionEnabled.set(true);
        });
      });
    } else {
      this.updateNavigationIndicator();
      this.hasInitialNavigationPosition = true;
      this.navigationIndicatorMotionEnabled.set(true);
    }
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.updateNavigationIndicator();
  }

  onNavigationIndicatorTransitionEnd(event: TransitionEvent): void {
    if (event.target !== event.currentTarget || event.propertyName !== 'transform') return;
    this.navigationIndicatorEnteringFromLeft.set(false);
  }

  ngOnDestroy(): void {
    this.navigationResizeObserver?.disconnect();
    if (this.initialPositionFrame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.initialPositionFrame);
    }
    if (this.motionEnableFrame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.motionEnableFrame);
    }
  }

  private setActiveNavigationItem(item: DashboardNavigationItem | null): void {
    const previousItem = this.activeNavigationItem();
    if (previousItem === null && item !== null && this.navigationLinkForItem(item)) {
      this.activeNavigationItem.set(item);
      this.stageNavigationIndicatorFromLeft(item, this.isAdminRoute(this.router.url));
      return;
    }

    if (item === null) {
      this.cancelPendingIndicatorFrames();
      this.stagingNavigationIndicator = false;
      this.navigationIndicatorEnteringFromLeft.set(false);
    }

    if (this.hasInitialNavigationPosition || this.navigationIndicator().visible) {
      this.navigationIndicatorMotionEnabled.set(true);
    }
    this.activeNavigationItem.set(item);
    this.updateNavigationIndicator();
  }

  private updateNavigationIndicator(): void {
    if (this.stagingNavigationIndicator) return;

    const activeItem = this.activeNavigationItem();
    if (activeItem === null) {
      this.navigationIndicator.update((position) => ({ ...position, visible: false }));
      this.observeNavigationLink(null);
      return;
    }

    this.setNavigationIndicatorPosition(activeItem);
  }

  private stageNavigationIndicatorFromLeft(
    item: DashboardNavigationItem,
    startFromFirstOption: boolean,
  ): void {
    this.cancelPendingIndicatorFrames();
    this.stagingNavigationIndicator = true;
    this.navigationIndicatorMotionEnabled.set(false);

    if (typeof requestAnimationFrame !== 'function') {
      this.stagingNavigationIndicator = false;
      this.hasInitialNavigationPosition = true;
      this.navigationIndicatorMotionEnabled.set(true);
      this.updateNavigationIndicator();
      return;
    }

    this.initialPositionFrame = requestAnimationFrame(() => {
      this.initialPositionFrame = null;
      this.setNavigationIndicatorStartPosition(item, startFromFirstOption);
      this.hasInitialNavigationPosition = true;
      this.motionEnableFrame = requestAnimationFrame(() => {
        this.motionEnableFrame = null;
        this.stagingNavigationIndicator = false;
        this.navigationIndicatorMotionEnabled.set(true);
        this.updateNavigationIndicator();
      });
    });
  }

  private setNavigationIndicatorPosition(item: DashboardNavigationItem): boolean {
    const geometry = this.navigationIndicatorGeometryForItem(item);
    if (!geometry) return false;

    this.setNavigationIndicatorGeometry(geometry);
    return true;
  }

  private setNavigationIndicatorFromLeft(item: DashboardNavigationItem): boolean {
    const geometry = this.navigationIndicatorGeometryForItem(item);
    if (!geometry) return false;

    const prefersReducedMotion = this.prefersReducedMotion();
    this.navigationIndicatorEnteringFromLeft.set(!prefersReducedMotion);
    this.setNavigationIndicatorGeometry(
      prefersReducedMotion ? geometry : { ...geometry, x: -geometry.width - 12 },
    );
    return true;
  }

  private setNavigationIndicatorStartPosition(
    item: DashboardNavigationItem,
    startFromFirstOption: boolean,
  ): boolean {
    if (!startFromFirstOption || this.prefersReducedMotion()) {
      return this.setNavigationIndicatorFromLeft(item);
    }

    const firstOptionGeometry = this.navigationIndicatorGeometryForItem('decks');
    if (!firstOptionGeometry) return this.setNavigationIndicatorPosition(item);

    this.navigationIndicatorEnteringFromLeft.set(false);
    this.setNavigationIndicatorGeometry(firstOptionGeometry);
    return true;
  }

  private prefersReducedMotion(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    );
  }

  private navigationIndicatorGeometryForItem(
    item: DashboardNavigationItem,
  ): NavigationIndicatorGeometry | null {
    const navigation = this.primaryNavigation?.nativeElement;
    const link = this.navigationLinkForItem(item);
    if (!navigation || !link) return null;

    if (this.observedNavigationItem !== link) {
      this.observeNavigationLink(link);
    }

    const navigationBounds = navigation.getBoundingClientRect();
    const linkBounds = link.getBoundingClientRect();
    return {
      x: linkBounds.left - navigationBounds.left + navigation.scrollLeft,
      y: linkBounds.top - navigationBounds.top + navigation.scrollTop,
      width: linkBounds.width,
      height: linkBounds.height,
    };
  }

  private setNavigationIndicatorGeometry(geometry: NavigationIndicatorGeometry): void {
    this.navigationIndicator.set({ ...geometry, visible: true });
  }

  private navigationLinkForItem(item: DashboardNavigationItem): HTMLAnchorElement | null {
    return (
      this.navigationItems?.find(
        (candidate) => candidate.nativeElement.dataset['navigationItem'] === item,
      )?.nativeElement ?? null
    );
  }

  private observeNavigationLink(link: HTMLAnchorElement | null): void {
    if (this.observedNavigationItem === link) return;
    if (this.observedNavigationItem) {
      this.navigationResizeObserver?.unobserve(this.observedNavigationItem);
    }
    if (link) this.navigationResizeObserver?.observe(link);
    this.observedNavigationItem = link;
  }

  private cancelPendingIndicatorFrames(): void {
    if (this.initialPositionFrame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.initialPositionFrame);
      this.initialPositionFrame = null;
    }
    if (this.motionEnableFrame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.motionEnableFrame);
      this.motionEnableFrame = null;
    }
  }

  private navigationItemForUrl(url: string): DashboardNavigationItem | null {
    const path = url.split(/[?#]/, 1)[0].replace(/\/$/, '') || '/';

    if (this.matchesPath(path, '/decks')) {
      return 'decks';
    }
    if (this.matchesPath(path, '/rooms')) {
      return 'rooms';
    }
    if (this.matchesPath(path, '/cards')) {
      return 'cards';
    }
    if (this.matchesPath(path, '/community')) {
      return 'community';
    }
    if (this.matchesPath(path, '/table-assistant')) {
      return 'table-assistant';
    }

    return null;
  }

  private initialNavigationUrl(): string {
    const currentNavigation = this.router.getCurrentNavigation();
    return (
      currentNavigation?.finalUrl?.toString() ??
      currentNavigation?.initialUrl?.toString() ??
      this.router.url
    );
  }

  private matchesPath(path: string, route: string): boolean {
    return path === route || path.startsWith(`${route}/`);
  }

  private isAdminRoute(url: string): boolean {
    const path = url.split(/[?#]/, 1)[0].replace(/\/$/, '') || '/';
    return this.matchesPath(path, '/admin');
  }
}
