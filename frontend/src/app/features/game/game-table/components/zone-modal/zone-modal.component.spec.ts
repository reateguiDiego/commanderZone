import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule, X } from 'lucide-angular';
import { ZoneModalState } from '../../state/zones/game-table-zone-modal.state';
import { ZoneModalComponent } from './zone-modal.component';

const ZONE_MODAL_NO_BACKDROP_STORAGE_KEY = 'cz_perf_zone_modal_no_backdrop';

describe('ZoneModalComponent', () => {
  beforeEach(() => {
    window.localStorage.removeItem(ZONE_MODAL_NO_BACKDROP_STORAGE_KEY);
  });

  afterEach(() => {
    window.localStorage.removeItem(ZONE_MODAL_NO_BACKDROP_STORAGE_KEY);
  });

  it('keeps backdrop blur enabled by default', async () => {
    const fixture = await renderModal();

    expect(backdrop(fixture).classList).not.toContain('zone-modal-backdrop--no-blur');
  });

  it('disables backdrop blur only when the performance flag is enabled', async () => {
    window.localStorage.setItem(ZONE_MODAL_NO_BACKDROP_STORAGE_KEY, '1');

    const fixture = await renderModal();

    expect(backdrop(fixture).classList).toContain('zone-modal-backdrop--no-blur');
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
