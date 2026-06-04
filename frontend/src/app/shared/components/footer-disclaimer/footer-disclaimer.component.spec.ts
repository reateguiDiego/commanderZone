import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { LegalLinksService } from '../../../core/legal/legal-links.service';
import { getPublicChromeCopy } from '../../../core/localization/public-chrome-copy';
import { FooterDisclaimerComponent } from './footer-disclaimer.component';

describe('FooterDisclaimerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FooterDisclaimerComponent],
      providers: [
        {
          provide: LegalLinksService,
          useValue: {
            chromeCopy: signal(getPublicChromeCopy('pt')),
          },
        },
      ],
    }).compileComponents();
  });

  it('renders the legal disclaimer content', () => {
    const fixture = TestBed.createComponent(FooterDisclaimerComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.app-disclaimer')).not.toBeNull();
    expect(compiled.querySelector('h2')?.textContent?.trim()).toBe('Aviso legal');
    expect(compiled.textContent).toContain('CommanderZone é conteúdo de fã não oficial');
    expect(compiled.textContent).toContain('Wizards of the Coast');
    expect(compiled.textContent).toContain(`© 1993–${new Date().getFullYear()} Wizards of the Coast LLC. All rights reserved.`);
    expect(Array.from(compiled.querySelectorAll('.app-disclaimer-links a')).map((link) => link.getAttribute('href'))).toEqual([
      '/pt/faq/',
      '/pt/assistente-mesa-commander/',
      '/pt/importar-deck-commander-mtg/',
      '/pt/politica-privacidade/',
      '/pt/politica-cookies/',
      '/pt/termos/',
      '/pt/contato/',
    ]);
  });
});
