import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CircleHelp, LucideAngularModule } from 'lucide-angular';
import { CardSearchHelpComponent } from './card-search-help.component';

describe('CardSearchHelpComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CardSearchHelpComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ CircleHelp })),
      ],
    }).compileComponents();
  });

  it('collapses when the user clicks outside the search guide', () => {
    const fixture = TestBed.createComponent(CardSearchHelpComponent);
    const component = fixture.componentInstance;

    component.internalOpen.set(true);
    fixture.detectChanges();

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(component.open()).toBe(false);
  });

  it('stays open when the user clicks inside the search guide', () => {
    const fixture = TestBed.createComponent(CardSearchHelpComponent);
    const component = fixture.componentInstance;

    component.internalOpen.set(true);
    fixture.detectChanges();

    fixture.nativeElement.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(component.open()).toBe(true);
  });

  it('emits close requests when controlled externally', () => {
    const fixture = TestBed.createComponent(CardSearchHelpComponent);
    const component = fixture.componentInstance;
    const openChange = vi.fn();
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('triggerVisible', false);
    fixture.componentRef.instance.openChange.subscribe(openChange);
    fixture.detectChanges();

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(openChange).toHaveBeenCalledWith(false);
  });
});
