import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LucideAngularModule, Upload } from 'lucide-angular';
import { SettingsAvatarUploadComponent } from './settings-avatar-upload.component';

describe('SettingsAvatarUploadComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsAvatarUploadComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ Upload }))],
    }).compileComponents();
  });

  it('requires an uploaded image before saving', () => {
    const fixture = TestBed.createComponent(SettingsAvatarUploadComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.canSave()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Maximum 2MB');
  });
});
