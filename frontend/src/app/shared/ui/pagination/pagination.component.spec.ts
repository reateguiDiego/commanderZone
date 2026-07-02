import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChevronLeft, ChevronRight, LucideAngularModule } from 'lucide-angular';
import { PaginationComponent } from './pagination.component';

describe('PaginationComponent', () => {
  let fixture: ComponentFixture<PaginationComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PaginationComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ ChevronLeft, ChevronRight })),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PaginationComponent);
    fixture.componentRef.setInput('currentPage', 2);
    fixture.componentRef.setInput('totalPages', 5);
    fixture.componentRef.setInput('ariaLabelKey', 'cards.cardSearch.pagination.label');
  });

  it('renders page status and translated navigation actions', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.pagination')?.getAttribute('aria-label')).toBe('Card search pagination');
    expect(fixture.nativeElement.textContent).toContain('2');
    expect(fixture.nativeElement.textContent).toContain('/ 5');
    expect(fixture.nativeElement.textContent).toContain('Previous');
    expect(fixture.nativeElement.textContent).toContain('Next');
  });

  it('emits navigation requests from enabled buttons', () => {
    const previousRequested = vi.fn();
    const nextRequested = vi.fn();
    fixture.componentInstance.previousRequested.subscribe(previousRequested);
    fixture.componentInstance.nextRequested.subscribe(nextRequested);
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('.pagination-button') as NodeListOf<HTMLButtonElement>;
    buttons[0].click();
    buttons[1].click();

    expect(previousRequested).toHaveBeenCalledTimes(1);
    expect(nextRequested).toHaveBeenCalledTimes(1);
  });

  it('disables navigation buttons independently', () => {
    fixture.componentRef.setInput('previousDisabled', true);
    fixture.componentRef.setInput('nextDisabled', true);
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('.pagination-button') as NodeListOf<HTMLButtonElement>;

    expect(buttons[0].disabled).toBe(true);
    expect(buttons[1].disabled).toBe(true);
  });
});
