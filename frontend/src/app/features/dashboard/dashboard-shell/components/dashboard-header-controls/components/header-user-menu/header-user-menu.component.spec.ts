import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Check, ChevronRight, LucideAngularModule, Menu } from 'lucide-angular';
import { HeaderUserMenuComponent } from './header-user-menu.component';

describe('HeaderUserMenuComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeaderUserMenuComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ Check, ChevronRight, Menu }))],
    }).compileComponents();
  });

  it('emits settings when selecting settings option', () => {
    const fixture = TestBed.createComponent(HeaderUserMenuComponent);
    const settingsSpy = vi.fn();
    fixture.componentInstance.settingsSelected.subscribe(settingsSpy);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.icon-button') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const menuItems = Array.from(
      fixture.nativeElement.querySelectorAll('.menu-item') as NodeListOf<HTMLButtonElement>,
    );
    const settingsButton = menuItems
      .find((button) => button.textContent?.includes('Settings')) as HTMLButtonElement;
    settingsButton.click();
    fixture.detectChanges();

    expect(settingsSpy).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('.header-menu-panel')).toBeNull();
  });

  it('updates selected language from the language picker', () => {
    const fixture = TestBed.createComponent(HeaderUserMenuComponent);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.icon-button') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const menuItems = Array.from(
      fixture.nativeElement.querySelectorAll('.menu-item') as NodeListOf<HTMLButtonElement>,
    );
    const languageButton = menuItems
      .find((button) => button.textContent?.includes('Language')) as HTMLButtonElement;
    languageButton.click();
    fixture.detectChanges();

    const languageItems = Array.from(
      fixture.nativeElement.querySelectorAll('.language-item') as NodeListOf<HTMLButtonElement>,
    );
    const frenchButton = languageItems
      .find((button) => button.textContent?.includes('Frances')) as HTMLButtonElement;
    frenchButton.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.selectedLanguage()).toBe('fr');
  });

  it('emits logoff when selecting log off option', () => {
    const fixture = TestBed.createComponent(HeaderUserMenuComponent);
    const logoffSpy = vi.fn();
    fixture.componentInstance.logoffSelected.subscribe(logoffSpy);
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.icon-button') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const menuItems = Array.from(
      fixture.nativeElement.querySelectorAll('.menu-item') as NodeListOf<HTMLButtonElement>,
    );
    const logoffButton = menuItems
      .find((button) => button.textContent?.includes('Log off')) as HTMLButtonElement;
    logoffButton.click();
    fixture.detectChanges();

    expect(logoffSpy).toHaveBeenCalledTimes(1);
  });
});
