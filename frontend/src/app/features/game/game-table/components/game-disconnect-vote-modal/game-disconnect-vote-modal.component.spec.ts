import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GameDisconnectVoteModalComponent } from './game-disconnect-vote-modal.component';

describe('GameDisconnectVoteModalComponent', () => {
  let fixture: ComponentFixture<GameDisconnectVoteModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GameDisconnectVoteModalComponent],
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
});
