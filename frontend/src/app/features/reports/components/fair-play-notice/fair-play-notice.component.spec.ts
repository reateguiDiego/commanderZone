import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule, X } from 'lucide-angular';
import { AppThemeService } from '../../../../core/theme/app-theme.service';
import { FairPlayNoticeService } from '../../data-access/fair-play-notice.service';
import { FairPlayNoticeComponent } from './fair-play-notice.component';

describe('FairPlayNoticeComponent', () => {
  let fixture: ComponentFixture<FairPlayNoticeComponent>;

  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');

    await TestBed.configureTestingModule({
      imports: [FairPlayNoticeComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ X }))],
    }).compileComponents();

    fixture = TestBed.createComponent(FairPlayNoticeComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.componentRef.setInput('gameId', 'game-1');
    fixture.detectChanges();
    TestBed.flushEffects();
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('uses a success modal with the Command Zone header logo and Balance card', () => {
    const panel = fixture.nativeElement.querySelector('.modal-panel') as HTMLElement;
    const logo = fixture.nativeElement.querySelector('.modal-header-image') as HTMLImageElement;
    const balance = fixture.nativeElement.querySelector(
      '.fair-play-notice__balance-card',
    ) as HTMLImageElement;

    expect(panel.classList).toContain('modal-panel-success');
    expect(panel.getAttribute('aria-label')).toBe('Play fair');
    expect(fixture.nativeElement.querySelector('.modal-title-row')).toBeNull();
    expect(logo.getAttribute('src')).toBe('/assets/icons/CZ/CZ_logo_zone_header.webp');
    expect(balance.getAttribute('src')).toBe(
      'https://cards.scryfall.io/normal/front/c/e/ce648aa3-098b-4af0-a433-fd290bc85904.jpg?1783937636',
    );
    expect(getComputedStyle(balance).borderRadius).toBe('15px');
  });

  it('follows the header logo theme and acknowledges through the existing service', () => {
    TestBed.inject(AppThemeService).selectTheme('candy-summoners');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.modal-header-image')?.getAttribute('src')).toBe(
      '/assets/icons/CZ/CZ_logo_zone_header_black.webp',
    );

    (fixture.nativeElement.querySelector('.primary-button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(TestBed.inject(FairPlayNoticeService).activeKey()).toBeNull();
    expect(fixture.nativeElement.querySelector('app-modal')).toBeNull();
  });
});
