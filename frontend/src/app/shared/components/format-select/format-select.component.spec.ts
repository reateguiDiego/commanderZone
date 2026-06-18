import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormatSelectComponent } from './format-select.component';

describe('FormatSelectComponent', () => {
  let fixture: ComponentFixture<FormatSelectComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FormatSelectComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FormatSelectComponent);
    fixture.componentRef.setInput('formats', [
      { id: 'commander', name: 'Commander' },
      { id: 'standard', name: 'Standard' },
    ]);
    fixture.detectChanges();
  });

  it('closes the dropdown when the user clicks outside', () => {
    const trigger = fixture.nativeElement.querySelector('.format-select-trigger') as HTMLButtonElement;

    trigger.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.format-select-menu')).not.toBeNull();

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.format-select-menu')).toBeNull();
  });
});
