import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BackButtonComponent } from './back-button.component';

describe('BackButtonComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BackButtonComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('renders the shared back label for links', () => {
    const fixture = TestBed.createComponent(BackButtonComponent);
    fixture.componentRef.setInput('link', '/cards');
    fixture.detectChanges();

    const anchor = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;

    expect(anchor).not.toBeNull();
    expect(anchor.textContent?.replace(/\s+/g, ' ').trim()).toContain('Atras');
  });

  it('emits pressed when used as an action button', () => {
    const fixture = TestBed.createComponent(BackButtonComponent);
    const emitted = vi.fn();
    fixture.componentInstance.pressed.subscribe(emitted);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('button').click();

    expect(emitted).toHaveBeenCalledOnce();
  });
});
