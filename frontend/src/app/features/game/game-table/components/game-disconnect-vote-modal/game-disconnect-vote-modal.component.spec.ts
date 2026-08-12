import { ComponentFixture, TestBed } from '@angular/core/testing';
import { importProvidersFrom } from '@angular/core';
import { LucideAngularModule, X } from 'lucide-angular';
import { GameDisconnectVoteModalComponent } from './game-disconnect-vote-modal.component';

describe('GameDisconnectVoteModalComponent', () => {
  let fixture: ComponentFixture<GameDisconnectVoteModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GameDisconnectVoteModalComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ X }))],
    }).compileComponents();

    fixture = TestBed.createComponent(GameDisconnectVoteModalComponent);
    fixture.detectChanges();
  });

  it('renders vote labels', () => {
    const component = fixture.componentInstance;

    expect(component.voteLabel('wait')).toBe('game.gameDisconnectVoteModal.wait');
    expect(component.voteLabel('expel')).toBe('game.gameDisconnectVoteModal.expel');
    expect(component.voteLabel(null)).toBe('game.gameDisconnectVoteModal.noVote');
  });

  it('renders the disconnected-player modal when opened by state', () => {
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('targetPlayerName', 'Player B');
    fixture.componentRef.setInput('canVote', true);
    fixture.detectChanges();

    const text = String(fixture.nativeElement.textContent ?? '');

    expect(text).toContain('Player disconnected');
    expect(text).toContain('Player B has disconnected.');
    expect(text).toContain('Expel');
  });

  it('does not render vote actions for a passive spectator', () => {
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('targetPlayerName', 'Player B');
    fixture.componentRef.setInput('canVote', false);
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('footer button') as NodeListOf<HTMLButtonElement>;
    const buttonLabels = Array.from(buttons).map((button) => button.textContent?.trim());

    expect(buttonLabels).not.toContain('Wait');
    expect(buttonLabels).not.toContain('Expel');
  });
});
