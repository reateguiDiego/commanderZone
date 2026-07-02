import { ComponentFixture, TestBed } from '@angular/core/testing';
import { importProvidersFrom } from '@angular/core';
import { Check, ChevronDown, LucideAngularModule, Send } from 'lucide-angular';
import { ChatRecipientSelectComponent } from './chat-recipient-select.component';

describe('ChatRecipientSelectComponent', () => {
  it('opens the recipient overlay and emits the selected recipient', async () => {
    const fixture = await renderComponent();
    const changed = vi.fn();
    fixture.componentInstance.valueChanged.subscribe(changed);

    (fixture.nativeElement.querySelector('[data-testid="chat-recipient"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const options = Array.from(fixture.nativeElement.querySelectorAll('.chat-recipient-option')) as HTMLButtonElement[];
    expect(options.map((option) => option.textContent?.trim())).toEqual(['All players', 'Opponent']);

    options[1]!.click();

    expect(changed).toHaveBeenCalledWith('player-2');
    expect(fixture.componentInstance.open()).toBe(false);
  });
});

async function renderComponent(): Promise<ComponentFixture<ChatRecipientSelectComponent>> {
  await TestBed.configureTestingModule({
    imports: [ChatRecipientSelectComponent],
    providers: [importProvidersFrom(LucideAngularModule.pick({ Check, ChevronDown, Send }))],
  }).compileComponents();

  const fixture = TestBed.createComponent(ChatRecipientSelectComponent);
  fixture.componentRef.setInput('recipients', [
    { playerId: null, label: 'All players' },
    { playerId: 'player-2', label: 'Opponent' },
  ]);
  fixture.componentRef.setInput('selectedValue', 'all');
  fixture.detectChanges();

  return fixture;
}
