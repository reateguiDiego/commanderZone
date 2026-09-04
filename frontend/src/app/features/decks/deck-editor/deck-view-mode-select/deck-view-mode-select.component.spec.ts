import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChevronDown, LucideAngularModule } from 'lucide-angular';
import { DeckViewModeSelectComponent } from './deck-view-mode-select.component';

describe('DeckViewModeSelectComponent', () => {
  it('uses the shared Text and Spoiler choices and emits the selected mode', async () => {
    await TestBed.configureTestingModule({
      imports: [DeckViewModeSelectComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ ChevronDown }))],
    }).compileComponents();

    const fixture = TestBed.createComponent(DeckViewModeSelectComponent);
    fixture.componentRef.setInput('idPrefix', 'deck-view-mode');
    fixture.componentRef.setInput('value', 'text');
    const selectedModes: string[] = [];
    fixture.componentInstance.valueChange.subscribe((value) => selectedModes.push(value));
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('.view-mode-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();

    const options = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.view-mode-option',
    ) as NodeListOf<HTMLButtonElement>;
    expect(options).toHaveLength(2);
    expect(options[0].getAttribute('aria-selected')).toBe('true');

    options[1].click();
    fixture.detectChanges();

    expect(selectedModes).toEqual(['spoiler']);
    expect(fixture.nativeElement.querySelector('.view-mode-menu')).toBeNull();
  });
});
