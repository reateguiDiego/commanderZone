import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CompactCheckboxComponent } from './compact-checkbox.component';

describe('CompactCheckboxComponent', () => {
  let fixture: ComponentFixture<CompactCheckboxComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CompactCheckboxComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(CompactCheckboxComponent);
    fixture.componentRef.setInput('label', 'Focus turn');
    fixture.detectChanges();
  });

  it('emits checked changes', () => {
    const changes: boolean[] = [];
    fixture.componentInstance.checkedChange.subscribe((checked) => changes.push(checked));

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event('change'));

    expect(changes).toEqual([true]);
  });

  it('projects an optional test id onto the native input', () => {
    fixture.componentRef.setInput('testId', 'follow-active-turn-player');
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    expect(input.dataset['testid']).toBe('follow-active-turn-player');
  });

  it('can stretch the tooltip trigger to the checkbox width', () => {
    fixture.componentRef.setInput('tooltipStretch', true);
    fixture.detectChanges();

    const tooltip = fixture.nativeElement.querySelector('.cz-tooltip') as HTMLElement;

    expect(tooltip.classList).toContain('cz-tooltip--stretch');
  });

  it('does not contain fixed tooltip positioning inside the checkbox host', () => {
    expect(getComputedStyle(fixture.nativeElement).contain).not.toContain('layout');
  });
});
