import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Crown, LucideAngularModule, X } from 'lucide-angular';
import { GameRematchModalComponent } from './game-rematch-modal.component';

describe('GameRematchModalComponent', () => {
  let fixture: ComponentFixture<GameRematchModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GameRematchModalComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ Crown, X }))],
    }).compileComponents();

    fixture = TestBed.createComponent(GameRematchModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('players', [
      { playerId: 'player-1', displayName: 'Winner', winner: true, life: 12, defeated: false, vote: 'play_again' },
      { playerId: 'player-2', displayName: 'Defeated', winner: false, life: 0, defeated: true, vote: null },
    ]);
  });

  it('renders the room votes and Commander Zone logo', () => {
    fixture.detectChanges();

    const logo = fixture.nativeElement.querySelector('.modal-header-image') as HTMLImageElement;
    const rows = fixture.nativeElement.querySelectorAll('.vote-row');

    expect(logo.getAttribute('src')).toBe('assets/icons/CZ/CZ_logo.webp');
    expect(rows.length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('Play again');
    expect(fixture.nativeElement.textContent).toContain('No vote');
    expect(fixture.nativeElement.querySelector('.modal-close-button')).toBeNull();
  });

  it('shows a close button after the current player has voted', () => {
    const closed = vi.fn();
    fixture.componentRef.setInput('currentVote', 'play_again');
    fixture.componentInstance.closed.subscribe(closed);
    fixture.detectChanges();

    const closeButton = fixture.nativeElement.querySelector('.modal-close-button') as HTMLButtonElement | null;
    closeButton?.click();

    expect(closeButton).not.toBeNull();
    expect(closed).toHaveBeenCalledOnce();
  });

  it('uses the winner copy when the current player is the last alive player', () => {
    fixture.componentRef.setInput('winner', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Legendary victory');
    expect(fixture.nativeElement.textContent).toContain('The table is yours.');
    expect(fixture.nativeElement.textContent).not.toContain('Premium finish');
  });

  it('marks the winner with a primary crown and applies the danger leave-room pill', () => {
    fixture.componentRef.setInput('players', [
      { playerId: 'player-1', displayName: 'Winner', winner: true, life: 12, defeated: false, vote: 'play_again' },
      { playerId: 'player-2', displayName: 'Leaving', winner: false, life: 0, defeated: true, vote: 'leave_room' },
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.winner-crown[name="crown"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.vote-pill[data-vote="leave_room"]')).not.toBeNull();
  });

  it('hides play again when the room can only be abandoned', () => {
    fixture.componentRef.setInput('playAgainDisabled', true);
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
    const playAgainButton = Array.from(buttons)
      .find((button): button is HTMLButtonElement => button.textContent?.trim() === 'Play again');
    const leaveButton = Array.from(buttons)
      .find((button): button is HTMLButtonElement => button.textContent?.trim() === 'Leave room');

    expect(playAgainButton).toBeUndefined();
    expect(leaveButton).toBeDefined();
    expect(fixture.nativeElement.textContent).toContain('The rest of the players have already voted to leave the room.');
  });

  it('explains the initial auto-leave countdown', () => {
    fixture.componentRef.setInput('countdownSeconds', 60);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Time limit');
    expect(fixture.nativeElement.textContent).toContain('60s');
    expect(fixture.nativeElement.textContent).toContain('You have 60s to vote.');
  });

  it('renders a server deadline without introducing a second countdown mode', () => {
    fixture.componentRef.setInput('countdownSeconds', 30);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Time limit');
    expect(fixture.nativeElement.textContent).toContain('30s');
    expect(fixture.nativeElement.textContent).toContain('You have 30s to vote.');
  });

  it('keeps showing the countdown for players that already voted', () => {
    fixture.componentRef.setInput('currentVote', 'play_again');
    fixture.componentRef.setInput('countdownSeconds', 42);
    fixture.componentRef.setInput('missingPlayerNames', ['Defeated', 'Pending']);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Defeated and Pending have 42s to vote.');
  });

  it('shows the shared server deadline after the current player voted', () => {
    fixture.componentRef.setInput('currentVote', 'play_again');
    fixture.componentRef.setInput('countdownSeconds', 18);
    fixture.componentRef.setInput('missingPlayerNames', ['Defeated']);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Defeated have 18s to vote.');
  });
});
