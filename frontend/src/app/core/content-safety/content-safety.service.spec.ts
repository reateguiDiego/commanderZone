import { TestBed } from '@angular/core/testing';
import { ContentSafetyService, containsExternalUrl } from './content-safety.service';

describe('ContentSafetyService', () => {
  let service: ContentSafetyService;

  beforeEach(() => {
    service = TestBed.inject(ContentSafetyService);
  });

  it('allows ordinary Commander table text', () => {
    expect(service.hasProhibitedContent('¿Robamos siete y empezamos la partida?')).toBe(false);
  });

  it('detects prohibited words with common separator evasions', () => {
    expect(service.hasProhibitedContent('f.u.c.k')).toBe(true);
    expect(service.hasProhibitedContent('f4ck')).toBe(true);
    expect(service.hasProhibitedContent('p.u.t.a')).toBe(true);
    expect(service.hasProhibitedContent('p-u-t-a')).toBe(true);
    expect(service.hasProhibitedContent('p_u_t_a')).toBe(true);
    expect(service.hasProhibitedContent('p·u·t·a')).toBe(true);
    expect(service.hasProhibitedContent('p・u・t・a')).toBe(true);
    expect(service.hasProhibitedContent('p\u00ADu\u00ADt\u00ADa')).toBe(true);
  });

  it('detects English obfuscations from the supplied corpus', () => {
    expect(service.hasProhibitedContent('f*u*c*k')).toBe(true);
    expect(service.hasProhibitedContent('b_a_s_t_a_r_d')).toBe(true);
    expect(service.hasProhibitedContent('m07h3rfuck3r')).toBe(true);
    expect(service.hasProhibitedContent('ａｓｓｈｏｌｅ')).toBe(true);
    expect(service.hasProhibitedContent('f\u2060u\u2060c\u2060k')).toBe(true);
    expect(service.hasProhibitedContent('fcking')).toBe(true);
    expect(service.hasProhibitedContent('fcuking')).toBe(true);
    expect(service.hasProhibitedContent('duck')).toBe(false);
  });

  it('detects external URLs and bare domains', () => {
    expect(service.hasProhibitedContent('Mira https://example.com/mazo')).toBe(true);
    expect(service.prohibitedContentModalMessage()).toBe('contentSafety.modal.external-url-message');
    expect(service.hasProhibitedContent('www.moxfield.com/decks/abc')).toBe(true);
    expect(service.hasProhibitedContent('Mi lista está en archidekt.net')).toBe(true);
    expect(service.hasProhibitedContent('Comparte evil.xyz')).toBe(true);
    expect(service.hasProhibitedContent('Empezamos a las 19.30')).toBe(false);
  });

  it('detects disguised URLs while allowing URL controls', () => {
    for (const value of ['ftp://example.com/file', 'http://[::1]:3000', 'example[.]org', 'hxxps://example.org', 'https : // example.com', 'https%3A%2F%2Fexample.net', 'ｈｔｔｐｓ：／／ｅｘａｍｐｌｅ．ｃｏｍ']) {
      expect(containsExternalUrl(value)).toBe(true);
    }

    expect(containsExternalUrl('Adjunto informe.pdf y evil.example')).toBe(true);

    for (const value of ['Versión 1.2.3', 'El precio es 10.50 euros.', 'Falta el destino: https://', 'El archivo es informe.pdf.']) {
      expect(containsExternalUrl(value), value).toBe(false);
    }
  });

  it('detects curated Catalan profanity', () => {
    expect(service.hasProhibitedContent('ves a la merda')).toBe(true);
    expect(service.prohibitedContentModalMessage()).toBe('contentSafety.modal.prohibited-language-message');
  });

  it('detects Catalan corpus evasions without blocking truncated false positives', () => {
    expect(service.hasProhibitedContent('cap de suro')).toBe(true);
    expect(service.hasProhibitedContent('tros de quòniam')).toBe(true);
    expect(service.hasProhibitedContent('ttorracollons')).toBe(true);
    expect(service.hasProhibitedContent('c*ap de suro')).toBe(true);
    expect(service.hasProhibitedContent('erda')).toBe(false);
    expect(service.hasProhibitedContent('ollons')).toBe(false);
    expect(service.hasProhibitedContent('uta')).toBe(false);
    expect(service.hasProhibitedContent('ap de cul')).toBe(false);
    expect(service.hasProhibitedContent('ill de puta')).toBe(false);
    expect(service.hasProhibitedContent('és a la merda')).toBe(false);
    expect(service.hasProhibitedContent('òstia')).toBe(false);
    expect(service.hasProhibitedContent('c*ap de cul')).toBe(true);
    expect(service.hasProhibitedContent('cul')).toBe(true);
  });

  it('detects prohibited expressions compacted into a single word', () => {
    expect(service.hasProhibitedContent('Tu putaMAdre')).toBe(true);
    expect(service.hasProhibitedContent('tuputa')).toBe(true);
    expect(service.hasProhibitedContent('tuputamaddrre')).toBe(true);
    expect(service.hasProhibitedContent('filldeputa')).toBe(true);
    expect(service.hasProhibitedContent('QuEtEjOdAn')).toBe(true);
    expect(service.hasProhibitedContent('VATEFaireENculer')).toBe(true);
    expect(service.hasProhibitedContent('krijgdetyfus')).toBe(true);
  });

  it('allows accepted words that include the letters puta', () => {
    expect(service.hasProhibitedContent('Tu reputación es buena')).toBe(false);
    expect(service.hasProhibitedContent('La disputa continúa')).toBe(false);
    expect(service.hasProhibitedContent('La amputación fue un éxito')).toBe(false);
    expect(service.hasProhibitedContent('No debes emputar a nadie')).toBe(false);
  });

  it('detects regional Spanish profanity', () => {
    expect(service.hasProhibitedContent('boludo')).toBe(true);
    expect(service.hasProhibitedContent('boludas')).toBe(true);
    expect(service.hasProhibitedContent('gilipollas')).toBe(true);
    expect(service.hasProhibitedContent('cabron')).toBe(true);
    expect(service.hasProhibitedContent('joder')).toBe(true);
    expect(service.hasProhibitedContent('pelotuda')).toBe(true);
    expect(service.hasProhibitedContent('concha')).toBe(true);
    expect(service.hasProhibitedContent('pinche')).toBe(true);
    expect(service.hasProhibitedContent('chingada')).toBe(true);
    expect(service.hasProhibitedContent('wey')).toBe(true);
    expect(service.hasProhibitedContent('conchetumadre')).toBe(true);
    expect(service.hasProhibitedContent('gonorrea')).toBe(true);
  });

  it('detects untested prohibited phrases in every supported language', () => {
    for (const value of [
      'que et bombin', 'leck mich am arsch', 'go fuck yourself', 'chupapollas',
      'trou du cul', 'porco dio', '死ね', 'krijg de tyfus', 'vai tomar no cu',
      'пошёл на хуй', '狗娘养的',
    ]) {
      expect(service.hasProhibitedContent(value)).toBe(true);
    }
  });

  it('keeps common and adversarial input checks responsive', () => {
    const service = TestBed.inject(ContentSafetyService);
    const startedAt = performance.now();

    for (let index = 0; index < 500; index += 1) {
      service.hasProhibitedContent(`Commander game ${index}: robo carta y paso turno.`);
    }
    for (let index = 0; index < 100; index += 1) {
      service.hasProhibitedContent('f·u·c·k');
    }

    expect(performance.now() - startedAt).toBeLessThan(1500);
  });

  it('detects native Japanese, Chinese, and Russian profanity', () => {
    expect(service.hasProhibitedContent('バカ')).toBe(true);
    expect(service.hasProhibitedContent('ハカ')).toBe(true);
    expect(service.hasProhibitedContent('アナル')).toBe(true);
    expect(service.hasProhibitedContent('他妈的')).toBe(true);
    expect(service.hasProhibitedContent('хуи')).toBe(true);
    expect(service.hasProhibitedContent('сука')).toBe(true);
  });

  it('allows only exact multilingual corpus false positives', () => {
    expect(service.hasProhibitedContent('cheiße')).toBe(false);
    expect(service.hasProhibitedContent('逼傻')).toBe(false);
    expect(service.hasProhibitedContent('鹿馬')).toBe(false);
    expect(service.hasProhibitedContent('cheiße!')).toBe(false);

    expect(service.hasProhibitedContent('s*cheiße')).toBe(true);
    expect(service.hasProhibitedContent('逼')).toBe(true);
    expect(service.hasProhibitedContent('傻.逼')).toBe(true);
    expect(service.hasProhibitedContent('馬.鹿')).toBe(true);
  });

  it('checks every supplied content field', () => {
    expect(service.hasProhibitedContentIn(['Una sala amistosa', 'f.u.c.k'])).toBe(true);
  });

  it('opens and dismisses the global prohibited-content modal', () => {
    service.showProhibitedContentModal();
    expect(service.prohibitedContentModalOpen()).toBe(true);

    service.dismissProhibitedContentModal();
    expect(service.prohibitedContentModalOpen()).toBe(false);
  });
});
