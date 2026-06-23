import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ToggleComponent } from './toggle.component';

describe('ToggleComponent', () => {
  let fixture: ComponentFixture<ToggleComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToggleComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ToggleComponent);
    fixture.componentRef.setInput('label', 'Show commander damage tracker');
    fixture.componentRef.setInput('description', 'Display commander damage counters in matches.');
    fixture.detectChanges();
  });

  it('renders the label and description', () => {
    const textContent = fixture.nativeElement.textContent;

    expect(textContent).toContain('Show commander damage tracker');
    expect(textContent).toContain('Display commander damage counters in matches.');
  });

  it('emits the next checked state when clicked', () => {
    const changes: boolean[] = [];
    fixture.componentInstance.checkedChange.subscribe((checked) => changes.push(checked));

    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.click();

    expect(changes).toEqual([true]);
  });

  it('does not emit changes when disabled', () => {
    const changes: boolean[] = [];
    fixture.componentInstance.checkedChange.subscribe((checked) => changes.push(checked));
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.click();

    expect(changes).toEqual([]);
  });

  it('sets switch state attributes', () => {
    fixture.componentRef.setInput('checked', true);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    expect(button.getAttribute('role')).toBe('switch');
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(button.classList).toContain('is-on');
  });
});
