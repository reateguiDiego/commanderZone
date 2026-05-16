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
    <app-extra-actions-menu>
      <button type="button" role="menuitem">
        <span>Commander damage</span>
        <small>Coming soon</small>
      </button>
    </app-extra-actions-menu>
  `,
})
class ExtraActionsMenuHostComponent {}

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
});

function toggle(root: HTMLElement): HTMLButtonElement {
  return root.querySelector('.extra-actions-toggle') as HTMLButtonElement;
}
