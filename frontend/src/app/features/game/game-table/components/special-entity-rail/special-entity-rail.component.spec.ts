import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Circle, Crown, Flag, Library, LucideAngularModule, Sparkles } from 'lucide-angular';
import { GameSpecialEntity } from '../../../../../core/models/game.model';
import { SpecialEntityRailComponent } from './special-entity-rail.component';

describe('SpecialEntityRailComponent', () => {
  let fixture: ComponentFixture<SpecialEntityRailComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SpecialEntityRailComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ Circle, Crown, Flag, Library, Sparkles })),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SpecialEntityRailComponent);
    fixture.componentRef.setInput('entities', [
      helperEntity('monarch', 'player-1'),
      helperEntity('the_ring', 'player-1', { level: 3, ringBearerInstanceId: 'card-1' }),
      {
        ...helperEntity('dungeon', 'player-1', { roomIndex: 1, roomName: 'Trap!' }),
        card: {
          scryfallId: 'dungeon-1',
          name: 'Lost Mine of Phandelver',
          imageUris: { normal: 'https://cards.example/dungeon.jpg' },
          cardFaces: [],
          typeLine: 'Dungeon',
          oracleText: null,
          layout: 'normal',
        },
      },
    ] satisfies GameSpecialEntity[]);
    fixture.componentRef.setInput('ringBearerName', () => 'Frodo');
    fixture.componentRef.setInput('imageFor', (entity: GameSpecialEntity) => entity.card?.imageUris?.['normal'] ?? null);
    fixture.detectChanges();
  });

  it('renders non-card helpers and ring metadata', () => {
    const text = fixture.nativeElement.textContent ?? '';

    expect(text).toContain('Monarch');
    expect(text).toContain('The Ring');
    expect(text).toContain('Ring level 3');
    expect(text).toContain('Frodo');
  });

  it('emits preview events for card-backed helpers', () => {
    const shown = vi.fn();
    const hidden = vi.fn();
    fixture.componentInstance.previewRequested.subscribe(shown);
    fixture.componentInstance.previewHidden.subscribe(hidden);

    const card = fixture.nativeElement.querySelector('.special-entity-pill-card-backed') as HTMLElement;
    card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    card.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    expect(shown).toHaveBeenCalledWith(expect.objectContaining({
      template: 'dungeon',
    }));
    expect(hidden).toHaveBeenCalled();
  });

  it('renders card-backed helpers as textual pills without inline mini-card art', () => {
    expect(fixture.nativeElement.querySelector('.special-entity-ring-button')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Lost Mine of Phandelver');
    expect(fixture.nativeElement.querySelector('.special-entity-pill-card-backed img')).toBeNull();
  });
});

function helperEntity(
  template: GameSpecialEntity['template'],
  ownerPlayerId: string | null,
  state: Record<string, unknown> = {},
): GameSpecialEntity {
  return {
    id: `${template}-${ownerPlayerId ?? 'global'}`,
    template,
    scope: ownerPlayerId ? 'player' : 'global',
    ownerPlayerId,
    card: null,
    state,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}
