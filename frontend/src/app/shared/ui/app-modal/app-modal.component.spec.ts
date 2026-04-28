import { TestBed } from '@angular/core/testing';
import { AppModalComponent } from './app-modal.component';

describe('AppModalComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppModalComponent],
    }).compileComponents();
  });

  it('renders projected modal content when open', () => {
    const fixture = TestBed.createComponent(AppModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('title', 'Confirm');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Confirm');
  });
});
