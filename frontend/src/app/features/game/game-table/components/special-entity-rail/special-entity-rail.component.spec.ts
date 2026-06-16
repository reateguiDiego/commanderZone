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
    fixture.detectChanges();
  });

  it('renders icon-first helpers with expandable copy metadata', () => {
    const pills = Array.from(fixture.nativeElement.querySelectorAll('.special-entity-pill')) as HTMLElement[];
    const labels = pills.map((pill) => pill.getAttribute('aria-label'));
    const copy = Array.from(fixture.nativeElement.querySelectorAll('.special-entity-pill-copy')) as HTMLElement[];

    expect(labels).toContain('Monarch');
    expect(labels).toContain('The Initiative');
    expect(labels).toContain('The Ring - Level 3 - Frodo');
    expect(labels).toContain('Lost Mine of Phandelver - Trap!');
    expect(copy.map((element) => element.textContent?.trim())).toEqual(expect.arrayContaining([
      'Monarch',
      'The Initiative',
      'The Ring - Level 3 - Frodo',
      'Lost Mine of Phandelver - Trap!',
    ]));
    expect(pills.some((pill) => pill.hasAttribute('title'))).toBe(false);
    expect(fixture.nativeElement.querySelector('.ms-ability-role-royal')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.ms-ability-d20')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.ms-ability-the-ring-tempts-you')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.ms-ability-dungeon')).not.toBeNull();
  });

  it('emits preview events for card-backed helpers', () => {
    const shown = vi.fn();
    const hidden = vi.fn();
    fixture.componentInstance.previewRequested.subscribe(shown);
    fixture.componentInstance.previewHidden.subscribe(hidden);

    const card = Array.from(fixture.nativeElement.querySelectorAll('.special-entity-pill-card-backed') as NodeListOf<HTMLElement>)
      .find((element) => element.getAttribute('aria-label')?.includes('Lost Mine of Phandelver')) as HTMLElement | undefined;
    expect(card).toBeTruthy();
    card?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    card?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    expect(shown).toHaveBeenCalledWith(expect.objectContaining({
      template: 'dungeon',
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

  it('renders card-backed helpers as expandable text pills without inline mini-card art or native tooltip', () => {
    expect(fixture.nativeElement.querySelector('.special-entity-ring-button')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Lost Mine of Phandelver');
    expect(fixture.nativeElement.querySelector('.special-entity-pill-card-backed')?.hasAttribute('title')).toBe(false);
    expect(fixture.nativeElement.querySelector('.special-entity-pill-card-backed img')).toBeNull();
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
