import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Globe, Lock, LucideAngularModule } from 'lucide-angular';
import { VisibilityChoiceComponent } from './visibility-choice.component';

describe('VisibilityChoiceComponent', () => {
  let fixture: ComponentFixture<VisibilityChoiceComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VisibilityChoiceComponent],
      providers: [
        importProvidersFrom(LucideAngularModule.pick({ Globe, Lock })),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VisibilityChoiceComponent);
    fixture.componentRef.setInput('value', 'private');
    fixture.detectChanges();
  });

  it('emits selected visibility', () => {
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((value) => emitted.push(value));

    const publicButton = fixture.nativeElement.querySelector('button');
    publicButton.click();

    expect(emitted).toEqual(['public']);
  });
});
