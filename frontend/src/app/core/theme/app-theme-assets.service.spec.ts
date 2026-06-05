import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { AppThemeAssetsService } from './app-theme-assets.service';
import { AppThemeService } from './app-theme.service';

describe('AppThemeAssetsService', () => {
  let documentRef: Document;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    documentRef = TestBed.inject(DOCUMENT);
    documentRef.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    localStorage.clear();
    documentRef.documentElement.removeAttribute('data-theme');
  });

  it('uses the regular CZ assets outside Candy Summoners', () => {
    const assets = TestBed.inject(AppThemeAssetsService);

    expect(assets.czLogoUrl()).toBe('/assets/icons/CZ/CZ_logo.png');
    expect(assets.czZoneHeaderLogoUrl()).toBe('/assets/icons/CZ/CZ_logo_zone_header.png');
    expect(assets.czCardsIconUrl()).toBe('/assets/icons/CZ/CZ_cards_icon.png');
  });

  it('uses black CZ assets only for Candy Summoners', () => {
    const appTheme = TestBed.inject(AppThemeService);
    const assets = TestBed.inject(AppThemeAssetsService);

    appTheme.selectTheme('candy-summoners');

    expect(assets.czLogoUrl()).toBe('/assets/icons/CZ/CZ_logo_black.png');
    expect(assets.czZoneHeaderLogoUrl()).toBe('/assets/icons/CZ/CZ_logo_zone_header_black.png');
    expect(assets.czCardsIconUrl()).toBe('/assets/icons/CZ/CZ_cards_icon_black.png');

    appTheme.selectTheme('sunrise');

    expect(assets.czLogoUrl()).toBe('/assets/icons/CZ/CZ_logo.png');
    expect(assets.czZoneHeaderLogoUrl()).toBe('/assets/icons/CZ/CZ_logo_zone_header.png');
    expect(assets.czCardsIconUrl()).toBe('/assets/icons/CZ/CZ_cards_icon.png');
  });
});
