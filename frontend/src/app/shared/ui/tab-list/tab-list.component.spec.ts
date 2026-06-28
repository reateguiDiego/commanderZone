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

    const tabList = fixture.nativeElement.querySelector('.tab-list') as HTMLElement;
    const buttons = fixture.nativeElement.querySelectorAll('.tab-list-button') as NodeListOf<HTMLButtonElement>;
    const indicator = fixture.nativeElement.querySelector('.tab-list-active-indicator') as HTMLElement;

    expect(fixture.nativeElement.querySelector('[role="tablist"]')).not.toBeNull();
    expect(tabList.classList).toContain('size-md');
    expect(indicator).not.toBeNull();
    expect(indicator.style.width).toBe('50%');
    expect(tabList.style.getPropertyValue('--cz-tab-active-index')).toBe('0');
    expect(buttons.length).toBe(2);
    expect(buttons[0].classList).toContain('active');
    expect(buttons[0].getAttribute('aria-selected')).toBe('true');
    expect(buttons[1].getAttribute('aria-selected')).toBe('false');
  });

  it('supports a larger tab size without changing the default size', () => {
    fixture.componentRef.setInput('size', 'lg');
    fixture.detectChanges();

    const tabList = fixture.nativeElement.querySelector('.tab-list') as HTMLElement;

    expect(tabList.classList).toContain('size-lg');
    expect(tabList.classList).not.toContain('size-md');
  });

  it('moves the pill indicator when the active tab changes', () => {
    fixture.detectChanges();

    const tabList = fixture.nativeElement.querySelector('.tab-list') as HTMLElement;
    expect(tabList.style.getPropertyValue('--cz-tab-active-index')).toBe('0');

    fixture.componentRef.setInput('activeId', 'game');
    fixture.detectChanges();

    expect(tabList.style.getPropertyValue('--cz-tab-active-index')).toBe('1');
  });

  it('does not render the moving pill indicator for underline tabs', () => {
    fixture.componentRef.setInput('variant', 'underline');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.tab-list-active-indicator')).toBeNull();
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
