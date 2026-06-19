import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CzButtonDirective, type CzButtonSize, type CzButtonTone, type CzButtonVariant } from './button.directive';

@Component({
  standalone: true,
  imports: [CzButtonDirective],
  template: `
    <button
      type="button"
      [czButton]="variant()"
      [czButtonSize]="size()"
      [czButtonTone]="tone()"
      [czButtonActive]="active()"
    >
      Save
    </button>
  `,
})
class ButtonDirectiveHostComponent {
  readonly variant = signal<CzButtonVariant>('primary');
  readonly size = signal<CzButtonSize>('sm');
  readonly tone = signal<CzButtonTone>('danger');
  readonly active = signal(true);
}

describe('CzButtonDirective', () => {
  let fixture: ComponentFixture<ButtonDirectiveHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ButtonDirectiveHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ButtonDirectiveHostComponent);
    fixture.detectChanges();
  });

  it('applies variant, size, tone, and active classes', () => {
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    expect(button.classList).toContain('cz-button');
    expect(button.classList).toContain('cz-button--primary');
    expect(button.classList).toContain('cz-button--sm');
    expect(button.classList).toContain('cz-button--tone-danger');
    expect(button.classList).toContain('cz-button--active');
  });

  it('updates classes when inputs change', () => {
    fixture.componentInstance.variant.set('text');
    fixture.componentInstance.size.set('lg');
    fixture.componentInstance.tone.set('success');
    fixture.componentInstance.active.set(false);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    expect(button.classList).toContain('cz-button--text');
    expect(button.classList).toContain('cz-button--lg');
    expect(button.classList).toContain('cz-button--tone-success');
    expect(button.classList).not.toContain('cz-button--active');
  });
});
