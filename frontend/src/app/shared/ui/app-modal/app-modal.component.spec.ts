import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ArrowLeft, LucideAngularModule } from 'lucide-angular';
import { AppModalComponent } from './app-modal.component';

describe('AppModalComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppModalComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ ArrowLeft }))],
    }).compileComponents();
  });

  it('renders projected modal content when open', () => {
    const fixture = TestBed.createComponent(AppModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('title', 'Confirm');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Confirm');
  });

  it('locks body scroll while open and restores it when closed', () => {
    const fixture = TestBed.createComponent(AppModalComponent);
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    document.body.style.position = '';

    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.position).toBe('fixed');

    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.position).toBe('');
    scrollToSpy.mockRestore();
  });

  it('emits back when the optional header back button is clicked', () => {
    const fixture = TestBed.createComponent(AppModalComponent);
    const emitted = vi.fn();
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('title', 'Settings');
    fixture.componentRef.setInput('showBackButton', true);
    fixture.componentInstance.back.subscribe(emitted);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.modal-back-button').click();

    expect(emitted).toHaveBeenCalledOnce();
  });

  it('emits header action from the optional title row action', () => {
    const fixture = TestBed.createComponent(AppModalComponent);
    const emitted = vi.fn();
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('title', 'Settings');
    fixture.componentRef.setInput('showHeaderAction', true);
    fixture.componentRef.setInput('headerActionLabel', 'Upload image');
    fixture.componentInstance.headerAction.subscribe(emitted);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.modal-header-action').click();

    expect(emitted).toHaveBeenCalledOnce();
  });
});
