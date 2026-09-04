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
      {
        ...helperEntity('initiative', 'player-1'),
        card: {
          scryfallId: 'initiative-1',
          name: 'Undercity // The Initiative',
          imageUris: { normal: 'https://cards.example/initiative.jpg' },
          cardFaces: [],
          typeLine: 'Dungeon - Undercity // Card',
          oracleText: null,
          layout: 'double_faced_token',
        },
      },
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
    fixture.detectChanges();
  });

  it('emits preview events for card-backed helpers', () => {
    const shown = vi.fn();
    const hidden = vi.fn();
    fixture.componentInstance.previewRequested.subscribe(shown);
    fixture.componentInstance.previewHidden.subscribe(hidden);

    const card = Array.from(fixture.nativeElement.querySelectorAll('.special-entity-pill-card-backed') as NodeListOf<HTMLElement>)
      .find((element) => element.getAttribute('aria-label')?.includes('Initiative')) as HTMLElement | undefined;
    expect(card).toBeTruthy();
    card?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    card?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    expect(shown).toHaveBeenCalledWith(expect.objectContaining({
      template: 'initiative',
    }));
    expect(hidden).toHaveBeenCalled();
  });

  it('emits preview events for icon-only helpers too', () => {
    const shown = vi.fn();
    const hidden = vi.fn();
    fixture.componentInstance.previewRequested.subscribe(shown);
    fixture.componentInstance.previewHidden.subscribe(hidden);

    const monarch = fixture.nativeElement.querySelector('.special-entity-pill') as HTMLElement;
    monarch.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    monarch.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    expect(shown).toHaveBeenCalledWith(expect.objectContaining({
      template: 'monarch',
    }));
    expect(hidden).toHaveBeenCalled();
  });

  it("emits a context request for City's Blessing on right click", () => {
    fixture.componentRef.setInput('entities', [{
      ...helperEntity('citys_blessing', 'player-1'),
      card: {
        scryfallId: 'citys-blessing-1',
        name: "City's Blessing",
        imageUris: { normal: 'https://cards.example/citys-blessing.jpg' },
        cardFaces: [],
        typeLine: 'Card',
        oracleText: null,
        layout: 'token',
      },
    } satisfies GameSpecialEntity]);
    fixture.detectChanges();
    const requested = vi.fn();
    fixture.componentInstance.entityContextRequested.subscribe(requested);

    const blessing = fixture.nativeElement.querySelector('.special-entity-pill-card-backed') as HTMLElement;
    blessing.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    expect(requested).toHaveBeenCalledWith(expect.objectContaining({
      entity: expect.objectContaining({ template: 'citys_blessing' }),
    }));
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
