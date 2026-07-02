import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ChevronRight, LucideAngularModule, Trophy } from 'lucide-angular';
import { DashboardTopCommandersComponent } from './dashboard-top-commanders.component';

describe('DashboardTopCommandersComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardTopCommandersComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ ChevronRight, Trophy })),
      ],
    }).compileComponents();
  });

  it('renders the mocked top three commanders with card images', () => {
    const fixture = TestBed.createComponent(DashboardTopCommandersComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const cards = element.querySelectorAll('.commander-card');
    const images = element.querySelectorAll<HTMLImageElement>('.commander-art img');
    const manaSymbols = element.querySelectorAll('app-mana-symbols');

    expect(cards.length).toBe(3);
    expect(element.textContent).toContain('The Ur-Dragon');
    expect(element.textContent).toContain('47,928 games');
    expect(element.textContent).not.toContain('decks');
    expect(element.textContent).toContain('Edgar Markov');
    expect(element.textContent).toContain('Atraxa, Grand Unifier');
    expect(images.length).toBe(3);
    expect(manaSymbols.length).toBe(3);
    expect(images[0]?.src).toContain('cards.scryfall.io/art_crop');
  });

  it('links the view more action to the community page', () => {
    const fixture = TestBed.createComponent(DashboardTopCommandersComponent);
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('.top-commanders-link') as HTMLAnchorElement | null;

    expect(link?.getAttribute('href')).toBe('/community');
  });
});
