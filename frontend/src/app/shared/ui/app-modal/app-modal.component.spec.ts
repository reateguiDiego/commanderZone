import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ArrowLeft, LucideAngularModule, X } from 'lucide-angular';
import { AppModalComponent } from './app-modal.component';

describe('AppModalComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppModalComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ ArrowLeft, X }))],
    }).compileComponents();
  });

  it('can provide an accessible label without rendering a visible title row', () => {
    const fixture = TestBed.createComponent(AppModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('ariaLabel', 'Select print version');
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;

    expect(dialog.getAttribute('aria-label')).toBe('Select print version');
    expect(fixture.nativeElement.querySelector('.modal-title-row')).toBeNull();
  });

  it('reserves header space when the close button is visible', () => {
    const fixture = TestBed.createComponent(AppModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('title', 'Player disconnected');
    fixture.componentRef.setInput('message', 'A long message that should wrap before it reaches the close button.');
    fixture.componentRef.setInput('showCloseButton', true);
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('.modal-panel') as HTMLElement;
    const header = fixture.nativeElement.querySelector('header') as HTMLElement;

    expect(panel.classList).toContain('modal-panel-has-close-button');
    expect(getComputedStyle(header).paddingInlineEnd).toBe('3.35rem');
  });

  it('locks body scroll while open and restores it when closed', () => {
    const fixture = TestBed.createComponent(AppModalComponent);
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.paddingRight = '';

    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.position).toBe('');
    expect(document.body.style.paddingRight).toBe('');

    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.position).toBe('');
    expect(document.body.style.paddingRight).toBe('');
    scrollToSpy.mockRestore();
  });

  it('can open without locking body scroll', () => {
    const fixture = TestBed.createComponent(AppModalComponent);
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    document.body.style.position = '';

    fixture.componentRef.setInput('lockBodyScroll', false);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    expect(document.documentElement.style.overflow).toBe('');
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.position).toBe('');
  });

  it('emits back when the optional header back button is clicked', () => {
    const fixture = TestBed.createComponent(AppModalComponent);
    const emitted = vi.fn();
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('title', 'Settings');
    fixture.componentRef.setInput('showBackButton', true);
    fixture.componentInstance.back.subscribe(emitted);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.modal-back-button button').click();

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

  it('can close from the backdrop when enabled', () => {
    const fixture = TestBed.createComponent(AppModalComponent);
    const emitted = vi.fn();
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('closeOnBackdrop', true);
    fixture.componentInstance.close.subscribe(emitted);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.modal-backdrop').click();

    expect(emitted).toHaveBeenCalledOnce();
  });

  it('does not close from the panel click when backdrop closing is enabled', () => {
    const fixture = TestBed.createComponent(AppModalComponent);
    const emitted = vi.fn();
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('closeOnBackdrop', true);
    fixture.componentInstance.close.subscribe(emitted);
    fixture.detectChanges();

    fixture.nativeElement.querySelector('.modal-panel').click();

    expect(emitted).not.toHaveBeenCalled();
  });

  it('supports a split footer with tertiary cancel and primary secondary action', () => {
    const fixture = TestBed.createComponent(AppModalComponent);
    const tertiary = vi.fn();
    const secondary = vi.fn();
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('showTertiary', true);
    fixture.componentRef.setInput('tertiaryLabel', 'Cancel');
    fixture.componentRef.setInput('secondaryLabel', 'Bottom');
    fixture.componentRef.setInput('secondaryVariant', 'primary');
    fixture.componentRef.setInput('primaryLabel', 'Top');
    fixture.componentRef.setInput('footerLayout', 'split');
    fixture.componentInstance.tertiary.subscribe(tertiary);
    fixture.componentInstance.secondary.subscribe(secondary);
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('footer button');
    buttons[0].click();
    buttons[1].click();

    expect(tertiary).toHaveBeenCalledOnce();
    expect(secondary).toHaveBeenCalledOnce();
  });
});
