import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ManaStylesService } from './mana-styles.service';

describe('ManaStylesService', () => {
  let documentRef: Document;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    documentRef = TestBed.inject(DOCUMENT);
    documentRef.getElementById('cz-mana-stylesheet')?.remove();
  });

  afterEach(() => {
    documentRef.getElementById('cz-mana-stylesheet')?.remove();
  });

  it('loads the Mana stylesheet once in the browser', () => {
    const service = TestBed.inject(ManaStylesService);

    service.load();
    service.load();

    const links = documentRef.querySelectorAll<HTMLLinkElement>('#cz-mana-stylesheet');

    expect(links.length).toBe(1);
    expect(links[0].rel).toBe('stylesheet');
    expect(links[0].getAttribute('href')).toBe('/vendor/mana/css/mana.min.css');
  });

  it('does not mutate the document during server rendering', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
    });
    documentRef = TestBed.inject(DOCUMENT);
    documentRef.getElementById('cz-mana-stylesheet')?.remove();

    TestBed.inject(ManaStylesService).load();

    expect(documentRef.getElementById('cz-mana-stylesheet')).toBeNull();
  });
});
