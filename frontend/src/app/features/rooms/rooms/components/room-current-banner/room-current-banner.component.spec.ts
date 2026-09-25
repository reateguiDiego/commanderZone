import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DoorOpen, Library, LogOut, LucideAngularModule, Play } from 'lucide-angular';
import { CurrentRoomSummary } from '../../../../../core/models/room.model';
import { RoomCurrentBannerComponent } from './room-current-banner.component';

describe('RoomCurrentBannerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RoomCurrentBannerComponent],
      providers: [
        provideRouter([]),
        importProvidersFrom(LucideAngularModule.pick({ DoorOpen, Library, LogOut, Play })),
      ],
    }).compileComponents();
  });

  it('renders only the turn number when a turn is available', () => {
    const fixture = renderBanner('waiting', 7);

    expect(turnValue(fixture.nativeElement)).toBe('7');
  });

  it('renders a compact waiting state before the game starts', () => {
    const fixture = renderBanner('waiting', null);

    expect(turnValue(fixture.nativeElement)).toBe('Waiting');
  });

  it('renders a compact live state when a started game has no turn snapshot', () => {
    const fixture = renderBanner('started', null);

    expect(turnValue(fixture.nativeElement)).toBe('Live');
  });

  it('hides the deck summary until a deck is selected', () => {
    const fixture = renderBanner('waiting', null);

    expect(fixture.nativeElement.querySelector('.deck-summary')).toBeNull();
  });

  it('renders the deck summary when a deck is selected', () => {
    const fixture = renderBanner('waiting', null);
    fixture.componentRef.setInput('currentPlayer', {
      playerId: 'player-1',
      deckId: 'deck-1',
      deckName: 'My deck',
      deckImageUrl: null,
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.deck-summary')?.textContent).toContain('My deck');
  });
});

function renderBanner(status: CurrentRoomSummary['status'], turnNumber: number | null) {
  const fixture = TestBed.createComponent(RoomCurrentBannerComponent);
  fixture.componentRef.setInput('room', room(status));
  fixture.componentRef.setInput('turn', { number: turnNumber });
  fixture.detectChanges();

  return fixture;
}

function turnValue(root: HTMLElement): string {
  return root.querySelector<HTMLElement>('.turn-summary strong')?.textContent?.trim() ?? '';
}

function room(status: CurrentRoomSummary['status']): CurrentRoomSummary {
  return {
    id: 'room-1',
    name: 'Room',
    status,
    visibility: 'public',
    format: 'commander',
    maxPlayers: 4,
    mulliganRule: 'LONDON',
    firstMulliganFree: true,
    playerCount: 1,
    gameId: status === 'started' ? 'game-1' : null,
  };
}
