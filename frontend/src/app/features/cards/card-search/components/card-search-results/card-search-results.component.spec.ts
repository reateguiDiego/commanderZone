import { TestBed } from '@angular/core/testing';
import { Card } from '../../../../../core/models/card.model';
import { CardSearchResultsComponent } from './card-search-results.component';

describe('CardSearchResultsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CardSearchResultsComponent],
    }).compileComponents();
  });

  it('renders list results as compact non-navigating rows', () => {
    const fixture = TestBed.createComponent(CardSearchResultsComponent);
    fixture.componentRef.setInput('results', [cardFixture()]);
    fixture.componentRef.setInput('searched', true);
    fixture.componentRef.setInput('viewMode', 'list');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Sol Ring');
    expect(fixture.nativeElement.textContent).not.toContain('Commander Masters');
    expect(fixture.nativeElement.textContent).not.toContain('rare');
    expect(fixture.nativeElement.querySelector('a.mtg-card-result')).toBeNull();
    expect(fixture.nativeElement.querySelector('button.mtg-card-result img')?.getAttribute('src')).toBe('/sol-ring.jpg');
  });

  it('opens a placeholder context menu instead of navigating', () => {
    const fixture = TestBed.createComponent(CardSearchResultsComponent);
    fixture.componentRef.setInput('results', [cardFixture()]);
    fixture.componentRef.setInput('searched', true);
    fixture.detectChanges();

    const result = fixture.nativeElement.querySelector('.mtg-card-result') as HTMLButtonElement;
    result.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 120, clientY: 80 }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.card-result-context-menu')?.textContent).toContain('TODO');
  });

  it('renders spoiler results as card images only', () => {
    const fixture = TestBed.createComponent(CardSearchResultsComponent);
    fixture.componentRef.setInput('results', [cardFixture()]);
    fixture.componentRef.setInput('searched', true);
    fixture.componentRef.setInput('viewMode', 'spoiler');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.card-results--spoiler img')?.getAttribute('src')).toBe('/sol-ring.jpg');
    expect(fixture.nativeElement.textContent).not.toContain('Sol Ring');
  });

  it('renders empty state after a completed search', () => {
    const fixture = TestBed.createComponent(CardSearchResultsComponent);
    fixture.componentRef.setInput('results', []);
    fixture.componentRef.setInput('searched', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No cards found.');
  });
});

function cardFixture(): Card {
  return {
    id: 'card-1',
    scryfallId: '00000000-0000-0000-0000-000000000001',
    name: 'Sol Ring',
    manaCost: '{1}',
    typeLine: 'Artifact',
    oracleText: '',
    colors: [],
    colorIdentity: [],
    legalities: { commander: 'legal' },
    imageUris: { normal: '/sol-ring.jpg' },
    layout: 'normal',
    commanderLegal: true,
    set: 'cmm',
    setName: 'Commander Masters',
    rarity: 'rare',
    collectorNumber: '1',
  };
}
