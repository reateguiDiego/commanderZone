import { browser } from 'k6/browser';
import { check } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

const base = (__ENV.FRONTEND_BASE_URL || 'http://127.0.0.1:4200').replace(/\/+$/, '');
const api = (__ENV.API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const completedNavigations = new Counter('cz_completed_navigations');
const requestsPerNavigation = new Trend('cz_http_requests_per_navigation');
const headerRequests = new Trend('cz_header_requests_per_navigation');
const bodyRequests = new Trend('cz_header_body_requests_per_navigation');
const inviteRequests = new Trend('cz_room_invite_requests_per_navigation');
const apiSuccess = new Rate('cz_navigation_api_success');
const successfulNavigation = new Rate('cz_browser_navigation_success');
const routeBudget = Number(__ENV.NAVIGATION_HTTP_BUDGET || '9');

export const options = {
  scenarios: { navigation: { executor: 'shared-iterations', vus: 1, iterations: 1, maxDuration: '3m', options: { browser: { type: 'chromium' } } } },
  thresholds: {
    cz_completed_navigations: ['count==7'],
    cz_browser_navigation_success: ['rate==1'],
    cz_navigation_api_success: ['rate==1'],
    cz_room_invite_requests_per_navigation: ['max<=1'],
    'cz_room_invite_requests_per_navigation{outside_rooms:true}': ['max==0'],
    'cz_header_requests_per_navigation{phase:cold}': ['max<=2'],
    'cz_header_requests_per_navigation{phase:warm}': ['max==0'],
    cz_header_body_requests_per_navigation: ['max==0'],
    'cz_http_requests_per_navigation{phase:warm}': [`max<=${routeBudget}`],
  },
  summaryTrendStats: ['count', 'avg', 'max'],
};

export default async function () {
  if (!__ENV.USER_EMAIL || !__ENV.USER_PASSWORD) throw new Error('USER_EMAIL and USER_PASSWORD are required');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  let counts = { all: 0, header: 0, body: 0, invites: 0 };
  let measuring = false;
  page.on('requestfailed', (request) => {
    if (measuring && request.url().startsWith(api + '/')) apiSuccess.add(false);
  });
  page.on('response', (response) => {
    if (measuring && response.url().startsWith(api + '/')) apiSuccess.add(response.status() >= 200 && response.status() < 400);
  });
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(api + '/')) return;
    counts.all++;
    const path = url.slice(api.length).split('?')[0];
    // All HTTP includes CORS preflights; resource budgets count application reads.
    if (request.method() === 'OPTIONS') return;
    if (path === '/rooms/invites/incoming') counts.invites++;
    if (/^\/(friends(?:\/|$)|messages(?:\/|$))/.test(path)) {
      counts.header++;
      if (!path.endsWith('/summary')) counts.body++;
    }
  });
  async function settle() {
    // Let the router render, then wait for fetch/XHR completion. SSE stays open.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForFunction(() => window.__czPendingHttp === 0);

  }
  function record(phase, route) {
    const tags = { phase, route };
    completedNavigations.add(1);
    requestsPerNavigation.add(counts.all, tags);
    headerRequests.add(counts.header, tags);
    bodyRequests.add(counts.body, tags);
    inviteRequests.add(counts.invites, { ...tags, outside_rooms: String(route !== '/rooms') });
    console.log(JSON.stringify({ phase, route, ...counts }));
  }
  try {
    await page.goto(base + '/auth/login');
    await page.evaluate(() => {
      window.__czPendingHttp = 0;
      const originalFetch = window.fetch;
      window.fetch = function (...args) {
        window.__czPendingHttp++;
        return originalFetch.apply(this, args).finally(() => { window.__czPendingHttp--; });
      };
      const send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function (...args) {
        window.__czPendingHttp++;
        this.addEventListener('loadend', () => { window.__czPendingHttp--; }, { once: true });
        try { return send.apply(this, args); } catch (error) { window.__czPendingHttp--; throw error; }
      };
    });
    await page.locator('input[formcontrolname="identifier"]').fill(__ENV.USER_EMAIL);
    await page.locator('input[autocomplete="current-password"]').fill(__ENV.USER_PASSWORD);
    counts = { all: 0, header: 0, body: 0, invites: 0 };
    measuring = true;
    await Promise.all([
      page.waitForResponse(api + '/friends/summary'),
      page.waitForResponse(api + '/messages/summary'),
      page.locator('button[type="submit"]').click(),
    ]);
    await page.locator('app-dashboard-header .friends-action').waitFor({ state: 'visible' });
    await settle();
    successfulNavigation.add(check(counts, { 'cold header loads exactly two summaries': (c) => c.header === 2 && c.body === 0 }));
    record('cold', 'login');
    const started = Date.now();
    for (const route of ['/decks', '/rooms', '/community', '/decks', '/rooms', '/community']) {
      counts = { all: 0, header: 0, body: 0, invites: 0 };
      if (route === '/community') {
        // Community has its own cache and may render without any HTTP request.
        await page.locator(`app-dashboard-header a[href="${route}"]`).click();
        await page.locator('app-community-page .community-preview-grid').waitFor({ state: 'visible' });
      } else {
        await Promise.all([
          page.waitForResponse(new RegExp('^' + api.replaceAll('.', '[.]') + route + '(?:[?]|$)')),
          page.locator(`app-dashboard-header a[href="${route}"]`).click(),
        ]);
      }
      await page.waitForFunction((expected) => location.pathname === expected, {}, route);
      await settle();
      const ok = check(page, { 'SPA route reached within cache TTL': () => Date.now() - started < 60_000 });
      successfulNavigation.add(ok);
      record('warm', route);
    }
  } catch (error) {
    successfulNavigation.add(false);
    throw error;
  } finally {
    await page.close();
    await context.close();
  }
}
