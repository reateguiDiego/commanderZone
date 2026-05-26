import { Component } from '@angular/core';
import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LucideAngularModule, Plus } from 'lucide-angular';
import { ExtraActionsMenuComponent } from './extra-actions-menu.component';

@Component({
  selector: 'app-extra-actions-menu-host',
  standalone: true,
  imports: [ExtraActionsMenuComponent],
  template: `
    <app-extra-actions-menu [viewportSafe]="viewportSafe">
      <button type="button" role="menuitem">
        <span>Commander damage</span>
        <small>Coming soon</small>
      </button>
    </app-extra-actions-menu>
  `,
})
class ExtraActionsMenuHostComponent {
  viewportSafe = false;
}

describe('ExtraActionsMenuComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExtraActionsMenuHostComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ Plus }))],
    }).compileComponents();
  });

  it('opens projected actions and closes from an outside click', () => {
    const fixture = TestBed.createComponent(ExtraActionsMenuHostComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.extra-actions-panel')).toBeNull();

    toggle(fixture.nativeElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.extra-actions-panel')?.textContent).toContain('Commander damage');

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.extra-actions-panel')).toBeNull();
  });

  it('keeps right clicks inside the panel from bubbling to parent menus', () => {
    const fixture = TestBed.createComponent(ExtraActionsMenuHostComponent);
    const parentContextMenu = vi.fn();
    fixture.nativeElement.addEventListener('contextmenu', parentContextMenu);
    fixture.detectChanges();

    toggle(fixture.nativeElement).click();
    fixture.detectChanges();

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    fixture.nativeElement.querySelector('.extra-actions-panel')?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(parentContextMenu).not.toHaveBeenCalled();
  });

  it('can position the panel inside the viewport instead of clipping inside a narrow parent', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 });
    const fixture = TestBed.createComponent(ExtraActionsMenuHostComponent);
    fixture.componentInstance.viewportSafe = true;
    fixture.detectChanges();
    const button = toggle(fixture.nativeElement);
    button.getBoundingClientRect = () => ({
      left: 280,
      top: 20,
      right: 312,
      bottom: 52,
      width: 32,
      height: 32,
      x: 280,
      y: 20,
      toJSON: () => ({}),
    });

    button.click();
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('.extra-actions-panel') as HTMLElement;
    expect(fixture.nativeElement.querySelector('.extra-actions')?.classList).toContain('viewport-safe');
    expect(panel.style.left).toBe('8px');
    expect(panel.style.width).toBe('304px');
  });

  it('keeps viewport-safe panels close to the toggle inside transformed containers', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 });
    const fixture = TestBed.createComponent(ExtraActionsMenuHostComponent);
    fixture.componentInstance.viewportSafe = true;
    fixture.detectChanges();
    const host = fixture.nativeElement.querySelector('app-extra-actions-menu') as HTMLElement;
    const button = toggle(fixture.nativeElement);
    const getComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => {
      const style = getComputedStyle(element);

      return {
        ...style,
        transform: element === host.parentElement ? 'matrix(1, 0, 0, 1, 0, 0)' : 'none',
        perspective: 'none',
        filter: 'none',
        getPropertyValue: (property: string) => property === 'contain' || property === 'backdrop-filter' ? '' : style.getPropertyValue(property),
      } as CSSStyleDeclaration;
    });
    host.parentElement!.getBoundingClientRect = () => ({
      left: 0,
      top: 160,
      right: 900,
      bottom: 660,
      width: 900,
      height: 500,
      x: 0,
      y: 160,
      toJSON: () => ({}),
    });
    button.getBoundingClientRect = () => ({
      left: 420,
      top: 184,
      right: 452,
      bottom: 216,
      width: 32,
      height: 32,
      x: 420,
      y: 184,
      toJSON: () => ({}),
    });

    button.click();
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('.extra-actions-panel') as HTMLElement;
    expect(panel.style.top).toBe('62px');
  });
});

function toggle(root: HTMLElement): HTMLButtonElement {
  return root.querySelector('.extra-actions-toggle') as HTMLButtonElement;
}
