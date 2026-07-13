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
    fixture.detectChanges();

    const text = String(fixture.nativeElement.textContent ?? '');

    expect(text).toContain('Player disconnected');
    expect(text).toContain('Player B has disconnected.');
    expect(text).toContain('Expel');
  });

	it('renders frozen quorum and hides vote actions for a read-only viewer', () => {
		fixture.componentRef.setInput('open', true);
		fixture.componentRef.setInput('canVote', false);
		fixture.componentRef.setInput('expelVotes', 2);
		fixture.componentRef.setInput('requiredVotes', 3);
		fixture.detectChanges();

		const element = fixture.nativeElement as HTMLElement;
		expect(element.querySelector('[data-testid="disconnect-vote-quorum"]')?.textContent).toContain('2 / 3');
		expect(element.querySelectorAll('footer button').length).toBe(0);
	});
});
