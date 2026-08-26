import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DeckBracketEstimate } from '../../../core/models/deck-analysis.model';
import { BracketLabelPillComponent } from './bracket-label-pill.component';

describe('BracketLabelPillComponent', () => {
  let fixture: ComponentFixture<BracketLabelPillComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BracketLabelPillComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(BracketLabelPillComponent);
  });

  it('renders the bracket icon and its existing localized label', () => {
    fixture.componentRef.setInput('bracket', { bracket: 3, label: 'Upgraded' } as DeckBracketEstimate);
    fixture.detectChanges();

    const pill = fixture.nativeElement.querySelector('.bracket-label-pill') as HTMLElement | null;
    const icon = pill?.querySelector('img') as HTMLImageElement | null;

    expect(pill?.textContent).toContain('Bracket 3');
    expect(icon?.getAttribute('src')).toBe('assets/icons/brackets/bracket_3.webp');
  });
});
