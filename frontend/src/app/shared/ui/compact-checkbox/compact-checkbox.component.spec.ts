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

  it('renders the checkbox label', () => {
    expect(fixture.nativeElement.textContent).toContain('Focus turn');
  });

  it('emits checked changes', () => {
    const changes: boolean[] = [];
    fixture.componentInstance.checkedChange.subscribe((checked) => changes.push(checked));

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event('change'));

    expect(changes).toEqual([true]);
  });
});
