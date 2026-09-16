import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService as NgxTranslateService } from '@ngx-translate/core';
import { EMPTY } from 'rxjs';
import { RuntimeTranslatePipe } from './runtime-translate.pipe';

const GAME_SETTING_LABEL_KEY = 'settings.dashboardSettingsModal.gameSettings.gameAnimations.label';

@Component({
  imports: [RuntimeTranslatePipe],
  template: '<span>{{ labelKey | runtimeTranslate }}</span>',
})
class RuntimeTranslatePipeTestHostComponent {
  labelKey = GAME_SETTING_LABEL_KEY;
}

describe('RuntimeTranslatePipe', () => {
  const translateMock = {
    instant: vi.fn((key: string) => key === GAME_SETTING_LABEL_KEY ? '' : key),
    onLangChange: EMPTY,
    onTranslationChange: EMPTY,
    onFallbackLangChange: EMPTY,
  };

  beforeEach(async () => {
    translateMock.instant.mockClear();

    await TestBed.configureTestingModule({
      imports: [RuntimeTranslatePipeTestHostComponent],
      providers: [
        { provide: NgxTranslateService, useValue: translateMock },
      ],
    }).compileComponents();
  });

  it('uses the runtime fallback when ngx-translate resolves a key to an empty string', () => {
    const fixture = TestBed.createComponent(RuntimeTranslatePipeTestHostComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent.trim()).toBe('Game animations');
    expect(translateMock.instant).toHaveBeenCalledWith(GAME_SETTING_LABEL_KEY, undefined);
  });

  it('does not call ngx-translate for an empty key', () => {
    const fixture = TestBed.createComponent(RuntimeTranslatePipeTestHostComponent);
    fixture.componentInstance.labelKey = '';
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toBe('');
    expect(translateMock.instant).not.toHaveBeenCalled();
  });
});
