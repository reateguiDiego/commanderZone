import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ContextSubmenuComponent, ContextSubmenuItem } from './context-submenu.component';

describe('ContextSubmenuComponent', () => {
  let fixture: ComponentFixture<ContextSubmenuComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContextSubmenuComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ContextSubmenuComponent);
  });

  it('keeps directional arrows aligned with the opened panel side', () => {
    fixture.componentRef.setInput('label', 'Root');
    fixture.componentRef.setInput('items', []);
    fixture.componentRef.setInput('expanded', true);
    fixture.componentRef.setInput('side', 'left');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.submenu.side-left')).not.toBeNull();
    expect(root.querySelector('.submenu-arrow.direction-left')).not.toBeNull();

    fixture.componentRef.setInput('direction', 'up');
    fixture.detectChanges();

    expect(root.querySelector('.submenu-arrow.direction-left')).not.toBeNull();
  });

  it('supports nested panels through the fifth themed level and emits the selected leaf', () => {
    const selected = vi.fn();
    fixture.componentInstance.itemSelected.subscribe(selected);
    fixture.componentRef.setInput('label', 'Root');
    fixture.componentRef.setInput('items', nestedItems());
    fixture.componentRef.setInput('expanded', true);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    for (const triggerIndex of [1, 2, 3, 4]) {
      const trigger = root.querySelectorAll<HTMLButtonElement>('.submenu-trigger')[triggerIndex];
      trigger?.click();
      fixture.detectChanges();
    }

    expect([1, 2, 3, 4, 5].every((level) => root.querySelector(`.submenu.level-${level}`) !== null)).toBe(true);

    root.querySelector<HTMLButtonElement>('[role="menuitem"]')?.click();

    expect(selected).toHaveBeenCalledWith('complete');
  });

  it('marks panels that switch left to remain inside the viewport', () => {
    fixture.componentRef.setInput('label', 'Root');
    fixture.componentRef.setInput('items', []);
    fixture.componentInstance.toggled.subscribe(() => fixture.componentRef.setInput('expanded', true));
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector<HTMLButtonElement>('.submenu-trigger');
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    try {
      vi.spyOn(trigger!, 'getBoundingClientRect').mockReturnValue({ right: 700 } as DOMRect);

      trigger?.click();
      fixture.detectChanges();

      expect(root.querySelector('.submenu.opens-left-to-fit')).not.toBeNull();
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
    }
  });

  it('keeps only one sibling submenu open at each depth', () => {
    fixture.componentRef.setInput('label', 'Root');
    fixture.componentRef.setInput('items', siblingItems());
    fixture.componentRef.setInput('expanded', true);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const [optionA, optionB] = Array.from(root.querySelectorAll<HTMLButtonElement>('app-context-submenu > .submenu > .submenu-trigger'));

    optionA?.click();
    fixture.detectChanges();
    optionB?.click();
    fixture.detectChanges();

    expect(optionA?.closest('.submenu')?.classList.contains('expanded')).toBe(false);
    expect(optionB?.closest('.submenu')?.classList.contains('expanded')).toBe(true);
    expect(root.querySelectorAll('.submenu-panel')).toHaveLength(2);
  });
});

function nestedItems(): readonly ContextSubmenuItem[] {
  return [nestedItem(2)];
}

function siblingItems(): readonly ContextSubmenuItem[] {
  return [
    { value: 'option-a', label: 'Option A', children: [{ value: 'a-leaf', label: 'A leaf' }] },
    { value: 'option-b', label: 'Option B', children: [{ value: 'b-leaf', label: 'B leaf' }] },
  ];
}


function nestedItem(depth: number): ContextSubmenuItem {
  return depth === 5
    ? {
        value: `level-${depth}`,
        label: `Level ${depth}`,
        children: [{ value: 'complete', label: 'Complete' }],
      }
    : {
        value: `level-${depth}`,
        label: `Level ${depth}`,
        children: [nestedItem(depth + 1)],
      };
}
