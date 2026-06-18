import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Globe, Lock, LucideAngularModule, X } from 'lucide-angular';
import { RoomSetupModalComponent } from './room-setup-modal.component';

describe('RoomSetupModalComponent', () => {
  let fixture: ComponentFixture<RoomSetupModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RoomSetupModalComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ Globe, Lock, X })),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RoomSetupModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('mode', 'create');
    fixture.componentRef.setInput('formats', [
      { id: 'commander', name: 'Commander', minCards: 100, maxCards: 100, hasCommander: true },
      { id: 'standard', name: 'Standard', minCards: 60, maxCards: 60, hasCommander: false },
    ]);
    fixture.detectChanges();
  });

  it('defaults Commander rooms to London with a free first mulligan', () => {
    expect(fixture.componentInstance.createFormat()).toBe('commander');
    expect(fixture.componentInstance.createMulliganRule()).toBe('LONDON');
    expect(fixture.componentInstance.createFirstMulliganFree()).toBe(true);
  });

  it('defaults non-Commander rooms to no free first mulligan', () => {
    fixture.componentInstance.changeCreateFormat('standard');

    expect(fixture.componentInstance.createMulliganRule()).toBe('LONDON');
    expect(fixture.componentInstance.createFirstMulliganFree()).toBe(false);
  });

  it('does not overwrite a manually changed free-mulligan checkbox when the format changes', () => {
    fixture.componentInstance.changeCreateFirstMulliganFree(true);
    fixture.componentInstance.changeCreateFormat('standard');

    expect(fixture.componentInstance.createFirstMulliganFree()).toBe(true);
  });

  it('toggles the free first mulligan from the setup button', () => {
    const button = fixture.nativeElement.querySelector('.mulligan-toggle-button') as HTMLButtonElement;

    expect(button.getAttribute('aria-pressed')).toBe('true');

    button.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.createFirstMulliganFree()).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });
});
