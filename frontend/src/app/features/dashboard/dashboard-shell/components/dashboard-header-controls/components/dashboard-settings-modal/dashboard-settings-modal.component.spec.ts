import { TestBed } from '@angular/core/testing';
import { DashboardSettingsModalComponent } from './dashboard-settings-modal.component';

describe('DashboardSettingsModalComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardSettingsModalComponent],
    }).compileComponents();
  });

  it('renders hello world content when open', () => {
    const fixture = TestBed.createComponent(DashboardSettingsModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Hello world');
  });
});
