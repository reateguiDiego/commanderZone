import {
  evaluateTcfPersonalizedAdsStatus,
  subscribeToTcfPersonalizedAdsStatus,
  TcfData,
} from './tcf-consent';

describe('tcf-consent', () => {
  afterEach(() => {
    globalThis.__tcfapi = undefined;
  });

  it('keeps personalized ads pending while the CMP UI is still unresolved', () => {
    expect(evaluateTcfPersonalizedAdsStatus({
      eventStatus: 'cmpuishown',
      gdprApplies: true,
    })).toBe('pending');
  });

  it('denies personalized ads when Google advertising consent or required purposes are missing', () => {
    expect(evaluateTcfPersonalizedAdsStatus(resolvedTcfData({
      purpose: { consents: { 1: true, 3: true, 4: true } },
      vendor: { consents: { 755: false } },
    }))).toBe('denied');

    expect(evaluateTcfPersonalizedAdsStatus(resolvedTcfData({
      purpose: { consents: { 1: true, 3: false, 4: true } },
      vendor: { consents: { 755: true } },
    }))).toBe('denied');
  });

  it('grants personalized ads only with resolved TCF consent for Google advertising products and required purposes', () => {
    expect(evaluateTcfPersonalizedAdsStatus(resolvedTcfData({
      purpose: { consents: { 1: true, 3: true, 4: true } },
      vendor: { consents: { 755: true } },
    }))).toBe('granted');
  });

  it('treats non-GDPR traffic as not restricted by the TCF gate', () => {
    expect(evaluateTcfPersonalizedAdsStatus({
      eventStatus: 'tcloaded',
      gdprApplies: false,
    })).toBe('granted');
  });

  it('subscribes to the CMP __tcfapi and maps events into statuses', () => {
    const statuses: string[] = [];
    let removedListenerId: number | null = null;

    globalThis.__tcfapi = (command, _version, callback, parameter) => {
      if (command === 'removeEventListener') {
        removedListenerId = parameter ?? null;
        callback({}, true);
        return;
      }

      callback({
        ...resolvedTcfData({
          purpose: { consents: { 1: true, 3: true, 4: true } },
          vendor: { consents: { 755: true } },
        }),
        listenerId: 12,
      }, true);
    };

    const subscription = subscribeToTcfPersonalizedAdsStatus((status) => statuses.push(status));
    subscription.unsubscribe();

    expect(statuses).toEqual(['granted']);
    expect(removedListenerId).toBe(12);
  });
});

function resolvedTcfData(overrides: Partial<TcfData>): TcfData {
  return {
    eventStatus: 'useractioncomplete',
    gdprApplies: true,
    tcString: 'tc-string',
    ...overrides,
  };
}
