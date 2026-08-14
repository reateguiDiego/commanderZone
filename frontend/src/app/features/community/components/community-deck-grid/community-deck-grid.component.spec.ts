import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { importProvidersFrom } from '@angular/core';
import { Copy, Globe, Heart, Lock, LucideAngularModule } from 'lucide-angular';
import { CommunityDeckSummary } from '../../../../core/models/community.model';
import { CommunityDeckGridComponent } from './community-deck-grid.component';

@Component({
  standalone: true,
  imports: [CommunityDeckGridComponent],
  template: `<app-community-deck-grid [decks]="decks()" />`,
})
class CommunityDeckGridHostComponent {
  readonly decks = signal<CommunityDeckSummary[]>([{
    id: 'deck-1',
    publicSlug: 'atraxa-tokens-d3ck0001',
    canonicalPath: '/community/decks/atraxa-tokens-d3ck0001/',
    name: 'Atraxa Tokens',
    format: 'commander',
    valid: true,
    cropImage: 'https://cards.test/atraxa.jpg',
    commanderName: 'Atraxa, Grand Unifier',
    colorIdentity: ['W', 'U', 'B', 'G'],
    updatedAt: '2026-06-26T00:00:00Z',
    likes: 17,
    copies: 4,
    bracket: { bracket: 2, label: 'Core' },
    creatorUserId: 'user-1',
  }]);
}

describe('CommunityDeckGridComponent', () => {
  let fixture: ComponentFixture<CommunityDeckGridHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommunityDeckGridHostComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ Copy, Globe, Heart, Lock })),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommunityDeckGridHostComponent);
    fixture.detectChanges();
  });

  it('renders likes and copies where owner actions would be shown on deck cards', () => {
    const metrics = fixture.nativeElement.querySelector('.community-deck-metrics') as HTMLElement | null;
    const metricValues = Array.from(fixture.nativeElement.querySelectorAll('.community-deck-metric span'))
      .map((element) => (element as HTMLElement).textContent?.trim());

    expect(metrics).not.toBeNull();
    expect(metricValues).toEqual(['17', '4']);
    expect(metrics?.querySelector('.metric-likes')?.getAttribute('aria-label')).toBe('Likes: 17');
    expect(metrics?.querySelector('.metric-copies')?.getAttribute('aria-label')).toBe('Copies: 4');
    expect(fixture.nativeElement.querySelector('app-bracket-label-pill')?.textContent).toContain('Bracket 2');
    expect(fixture.nativeElement.querySelector('.visibility-pill')).toBeNull();
  });
});
