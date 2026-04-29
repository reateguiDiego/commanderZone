import { convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { GamesApi } from '../../../core/api/games.api';
import { MercureService } from '../../../core/realtime/mercure.service';
import { GameTableComponent } from './game-table.component';

describe('GameTableComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GameTableComponent],
      providers: [
        { provide: GamesApi, useValue: { snapshot: vi.fn(), command: vi.fn() } },
        { provide: MercureService, useValue: { gameEvents: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({}) } },
        },
      ],
    }).compileComponents();
  });

  it('shows a missing game id error without a route id', () => {
    const fixture = TestBed.createComponent(GameTableComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.error()).toBe('Missing game id.');
  });
});
