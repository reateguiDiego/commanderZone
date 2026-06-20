import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TabListComponent } from './tab-list.component';

describe('TabListComponent', () => {
  let fixture: ComponentFixture<TabListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TabListComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TabListComponent);
    fixture.componentRef.setInput('items', [
      { id: 'general', label: 'General' },
      { id: 'game', label: 'Game', disabled: true },
    ]);
    fixture.componentRef.setInput('activeId', 'general');
  });

  it('renders tabs with the active state and tab semantics', () => {
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('.tab-list-button') as NodeListOf<HTMLButtonElement>;

    expect(fixture.nativeElement.querySelector('[role="tablist"]')).not.toBeNull();
    expect(buttons.length).toBe(2);
    expect(buttons[0].classList).toContain('active');
    expect(buttons[0].getAttribute('aria-selected')).toBe('true');
    expect(buttons[1].getAttribute('aria-selected')).toBe('false');
  });

  it('emits selected tab ids and ignores disabled tabs', () => {
    const selectedSpy = vi.fn();
    fixture.componentInstance.tabSelected.subscribe(selectedSpy);
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('.tab-list-button') as NodeListOf<HTMLButtonElement>;
    buttons[0].click();
    buttons[1].click();

    expect(selectedSpy).toHaveBeenCalledTimes(1);
    expect(selectedSpy).toHaveBeenCalledWith('general');
  });
});
