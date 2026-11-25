import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule, X } from 'lucide-angular';
import { ZoneModalState } from '../../state/zones/game-table-zone-modal.state';
import { ZoneModalComponent } from './zone-modal.component';

describe('ZoneModalComponent', () => {
  it('renders the zone modal without backdrop blur', async () => {
    const fixture = await renderModal();

    expect(getComputedStyle(backdrop(fixture)).backdropFilter).toBe('none');
  });
});

async function renderModal(): Promise<ComponentFixture<ZoneModalComponent>> {
  await TestBed.configureTestingModule({
    imports: [ZoneModalComponent],
    providers: [importProvidersFrom(LucideAngularModule.pick({ X }))],
  }).compileComponents();

  const fixture = TestBed.createComponent(ZoneModalComponent);
  fixture.componentRef.setInput('modal', modalState());
  fixture.componentRef.setInput('cardImage', () => '/card.jpg');
  fixture.detectChanges();

  return fixture;
}

function backdrop(fixture: ComponentFixture<ZoneModalComponent>): HTMLElement {
  return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.zone-modal-backdrop')!;
}

function modalState(): ZoneModalState {
  return {
    playerId: 'player-1',
    zone: 'library',
    title: 'Library',
    selectedCardId: null,
    cards: [],
    filterSourceCards: null,
    total: 0,
    type: '',
    search: '',
    showFilters: false,
    readOnly: true,
    allowRandomSelect: false,
    allowReorder: false,
    drawOrderLabels: [],
    viewTopCount: null,
    selectedCard: null,
    loading: false,
  };
}
