import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule, Plus } from 'lucide-angular';
import { GameZoneName } from '../../../../core/models/game.model';
import { PlayerView } from '../state/game-table-snapshot-selectors';
import { PlayerSummaryPanelComponent } from './player-summary-panel.component';

describe('PlayerSummaryPanelComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlayerSummaryPanelComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ Plus }))],
    }).compileComponents();
  });

  it('opens and closes the extra player controls menu', () => {
    const fixture = createFixture();

    expect(fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-panel')).toBeNull();

    extraToggle(fixture).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-panel')?.textContent).toContain('Commander damage');

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-panel')).toBeNull();
  });

  it('emits life changes from the life total control', () => {
    const fixture = createFixture();
    const lifeChanged = vi.fn();
    fixture.componentInstance.lifeChanged.subscribe(lifeChanged);

    const lifeButton = fixture.nativeElement.querySelector('[data-testid="life-value"]') as HTMLButtonElement;
    const parentContextMenu = vi.fn();
    fixture.nativeElement.addEventListener('contextmenu', parentContextMenu);
    lifeButton.click();
    lifeButton.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));

    expect(lifeChanged).toHaveBeenNthCalledWith(1, { playerId: 'player-1', delta: 1 });
    expect(lifeChanged).toHaveBeenNthCalledWith(2, { playerId: 'player-1', delta: -1 });
    expect(parentContextMenu).not.toHaveBeenCalled();
  });
});

function createFixture(): ComponentFixture<PlayerSummaryPanelComponent> {
  const fixture = TestBed.createComponent(PlayerSummaryPanelComponent);
  fixture.componentRef.setInput('player', player());
  fixture.componentRef.setInput('colorAccent', () => '#d7b46a');
  fixture.componentRef.setInput('deckLabel', () => 'Test deck');
  fixture.componentRef.setInput('manaSymbols', () => ['B', 'G']);
  fixture.detectChanges();

  return fixture;
}

function extraToggle(fixture: ComponentFixture<PlayerSummaryPanelComponent>): HTMLButtonElement {
  return fixture.nativeElement.querySelector('.player-extra-actions .extra-actions-toggle') as HTMLButtonElement;
}

function player(): PlayerView {
  return {
    id: 'player-1',
    state: {
      user: { id: 'player-1', email: 'player@test', displayName: 'Player', roles: [] },
      status: 'active',
      life: 40,
      commanderDamage: {},
      counters: {},
      zones: {
        library: [],
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
        command: [],
      } satisfies Record<GameZoneName, []>,
    },
  } as unknown as PlayerView;
}
