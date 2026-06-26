import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ChevronRight, LucideAngularModule, Trophy } from 'lucide-angular';
import { CardPreviewSectionComponent } from './card-preview-section.component';

describe('CardPreviewSectionComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CardPreviewSectionComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ ChevronRight, Trophy })),
      ],
    }).compileComponents();
  });

  it('renders preview items with crop images and optional metadata', () => {
    const fixture = TestBed.createComponent(CardPreviewSectionComponent);
    fixture.componentRef.setInput('title', 'Preview');
    fixture.componentRef.setInput('subtitle', 'Latest picks');
    fixture.componentRef.setInput('footerNote', 'Preview only');
    fixture.componentRef.setInput('showRank', true);
    fixture.componentRef.setInput('items', [
      {
        id: 'card-1',
        scryfallId: 'card-scryfall-1',
        name: 'Atraxa, Grand Unifier',
        cropImage: 'https://cards.scryfall.io/art_crop/front/atraxa.jpg',
        rank: 1,
        label: 'Featured',
        colors: ['W', 'U', 'B', 'G'],
      },
    ]);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('Preview');
    expect(element.textContent).toContain('Latest picks');
    expect(element.textContent).toContain('Atraxa, Grand Unifier');
    expect(element.textContent).toContain('Featured');
    expect(element.textContent).toContain('Preview only');
    expect(element.querySelectorAll('.commander-card')).toHaveLength(1);
    expect(element.querySelector('.commander-art img')?.getAttribute('src')).toContain('art_crop');
  });

  it('adds the mobile text-mode host class only when requested', () => {
    const fixture = TestBed.createComponent(CardPreviewSectionComponent);
    fixture.componentRef.setInput('title', 'Preview');
    fixture.componentRef.setInput('smallScreenTextMode', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.classList.contains('small-screen-text-mode')).toBe(true);
  });

  it('adds the mobile header-only host class only when requested', () => {
    const fixture = TestBed.createComponent(CardPreviewSectionComponent);
    fixture.componentRef.setInput('title', 'Preview');
    fixture.componentRef.setInput('mobileHeaderOnly', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.classList.contains('mobile-header-only')).toBe(true);
  });
});
