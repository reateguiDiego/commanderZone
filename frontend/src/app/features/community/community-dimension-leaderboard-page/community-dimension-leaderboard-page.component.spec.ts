import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CommunityApi } from '../../../core/api/community.api';
import { CommunityDimensionLeaderboardPageComponent } from './community-dimension-leaderboard-page.component';

describe('CommunityDimensionLeaderboardPageComponent', () => {
  it('renders the color ranking returned by the API', async () => {
    const api = {
      topColors: vi.fn().mockReturnValue(of({
        total: 2,
        items: [
          { key: 'WUB', label: 'WUB', colors: ['W', 'U', 'B'], timesPlayed: 12, rank: 1 },
          { key: 'C', label: 'Colorless', timesPlayed: 4, rank: 2 },
        ],
      })),
      topArchetypes: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [CommunityDimensionLeaderboardPageComponent],
      providers: [
        provideRouter([]),
        { provide: CommunityApi, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { data: { kind: 'colors' } } } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CommunityDimensionLeaderboardPageComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();

    expect(api.topColors).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.textContent).toContain('Top Deck Colors');
    expect(fixture.nativeElement.textContent).toContain('Colorless');
    expect(fixture.nativeElement.querySelectorAll('.leaderboard-row')).toHaveLength(2);
  });
});
