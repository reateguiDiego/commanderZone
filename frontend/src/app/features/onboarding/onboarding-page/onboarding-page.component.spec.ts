import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { OnboardingPageComponent } from './onboarding-page.component';

describe('OnboardingPageComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OnboardingPageComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('renders the onboarding page', () => {
    const fixture = TestBed.createComponent(OnboardingPageComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Play Commander online in seconds');
  });

  it('renders account navigation actions', () => {
    const fixture = TestBed.createComponent(OnboardingPageComponent);
    fixture.detectChanges();

    const links = Array.from(fixture.nativeElement.querySelectorAll('a')) as HTMLAnchorElement[];

    expect(links.some((link) => link.textContent?.trim() === 'Login' && link.getAttribute('href') === '/auth/login')).toBe(true);
    expect(links.some((link) => link.textContent?.trim() === 'Sign up' && link.getAttribute('href') === '/auth/register')).toBe(true);
  });

  it('does not allow importing an empty decklist', () => {
    const fixture = TestBed.createComponent(OnboardingPageComponent);
    const component = fixture.componentInstance;
    component.importDeck();
    expect(component.importError()).toBe('Paste a decklist before importing.');
  });

  it('allows advancing after importing a decklist', () => {
    const fixture = TestBed.createComponent(OnboardingPageComponent);
    const component = fixture.componentInstance;
    component.decklist.set('1 Sol Ring');
    component.importDeck();
    expect(component.deckImported()).toBe(true);
  });

  it('creates a mock room link', () => {
    const fixture = TestBed.createComponent(OnboardingPageComponent);
    const component = fixture.componentInstance;
    component.decklist.set('1 Sol Ring');
    component.importDeck();
    component.createRoom();
    expect(component.room()?.link).toMatch(/^\/room\/demo-/);
  });

  it('shows copied feedback after copying the link', async () => {
    const fixture = TestBed.createComponent(OnboardingPageComponent);
    const component = fixture.componentInstance;
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });

    component.decklist.set('1 Sol Ring');
    component.importDeck();
    component.createRoom();
    await component.copyLink();

    expect(component.copied()).toBe(true);
    expect(clipboardWriteText).toHaveBeenCalled();
  });
});
