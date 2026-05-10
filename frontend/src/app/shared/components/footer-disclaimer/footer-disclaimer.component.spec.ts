import { TestBed } from '@angular/core/testing';
import { FooterDisclaimerComponent } from './footer-disclaimer.component';

describe('FooterDisclaimerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FooterDisclaimerComponent],
    }).compileComponents();
  });

  it('renders the legal disclaimer content', () => {
    const fixture = TestBed.createComponent(FooterDisclaimerComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.app-disclaimer')).not.toBeNull();
    expect(compiled.textContent).toContain('CommanderZone is unofficial Fan Content');
    expect(compiled.textContent).toContain('Wizards of the Coast');
  });
});
