import http from 'k6/http';
import execution from 'k6/execution';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const API = (__ENV.API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const USERS = Number.parseInt(__ENV.USERS || '50', 10);
const PROFILE = __ENV.PROFILE || 'baseline';
const MIX = __ENV.NAVIGATION_MIX || 'navigation';
const COLD = __ENV.ANALYSIS_STATE === 'cold';
const FIXTURES = __ENV.ANALYSIS_FIXTURES ? JSON.parse(open(__ENV.ANALYSIS_FIXTURES)) : null;
if (COLD && (!Array.isArray(FIXTURES) || FIXTURES.length < USERS || FIXTURES.some(f => !Array.isArray(f.deckIds) || !f.deckIds.length) || !(MIX in { basic:1, advanced:1, bracket:1 }))) throw new Error('Cold runs require nonempty ANALYSIS_FIXTURES for every user and one analysis kind.');
const RAMP = __ENV.RAMP_DURATION || '1m';
const HOLD = __ENV.DURATION || '10m';
const TERMS = (__ENV.FRIEND_SEARCH_TERMS || 'es,test,test01,zznomatchzz').split(',');
const duration = new Trend('cz_navigation_endpoint_ms', true);
const errors = new Rate('cz_navigation_endpoint_errors');
const requests = new Counter('cz_navigation_requests');
const bytes = new Counter('cz_navigation_response_bytes');
const incomplete = new Rate('cz_navigation_incomplete');
const navigation = [
  ['/me', 'me'], ['/rooms', 'rooms'], ['/rooms/current', 'rooms_current'],
  ['/decks', 'decks'], ['/decks/summary', 'decks_summary'], ['/deck-folders', 'deck_folders'],
  ['/friends/summary', 'friends_summary'], ['/messages/summary', 'messages_summary'],
  ['/community', 'community'], ['/community/decks', 'community_decks'],
];
const analyses = { basic: 'deck_analysis', advanced: 'deck_advanced_analysis', bracket: 'deck_bracket' };
const webReads = [
  ['/decks?limit=25', 'decks'], ['/decks/summary', 'decks_summary'], ['/deck-folders', 'deck_folders'],
  ['/cards/search/options', 'cards_search_options'], ['/cards/languages', 'cards_languages'],
  ['/cards/search?q=sol&lang=en&limit=25', 'cards_search_prefix'],
  ['/cards/search?q=Sol%20Ring&lang=en&limit=25', 'cards_search_name'],
  ['/cards/search?q=anillo&lang=es&limit=25', 'cards_search_localized'],
  ['/cards/search?q=dragon&commanderLegal=true&lang=en&limit=25&page=2', 'cards_search_filtered_page'],
  ['/cards/search?q=zznomatchzz&lang=en&limit=25', 'cards_search_empty'],
];
if (!['navigation', 'panels', 'basic', 'advanced', 'bracket', 'mixed', 'web'].includes(MIX)) throw new Error('Invalid NAVIGATION_MIX');
const endpoints = MIX === 'web' ? [...webReads.map(p => p[1]), 'deck_detail', 'deck_sections']
  : MIX === 'mixed' ? [...navigation.map(p => p[1]), analyses.basic, analyses.advanced]
  : MIX in analyses ? [analyses[MIX]]
  : [...navigation.map(p => p[1]), ...(MIX === 'panels' ? ['friends', 'messages', 'friends_search'] : [])];
const thresholds = { cz_navigation_incomplete: ['rate==0'] };
for (const endpoint of endpoints) {
  const tags = `{endpoint:${endpoint},phase:stable}`;
  const analysis = Object.values(analyses).includes(endpoint);
  thresholds[`cz_navigation_endpoint_ms${tags}`] = analysis ? ['p(95)<1500', 'p(99)<3000'] : ['p(95)<500', 'p(99)<1000'];
  thresholds[`cz_navigation_endpoint_errors${tags}`] = ['rate<0.01'];
  thresholds[`cz_navigation_requests${tags}`] = ['count>0'];
  if (analysis && (__ENV.ANALYSIS_STATE || 'warm') === 'warm') {
    thresholds[`cz_navigation_endpoint_ms{endpoint:${endpoint},phase:stable,snapshot:fresh}`] = ['p(95)<500', 'p(99)<1000'];
    thresholds[`cz_navigation_requests{endpoint:${endpoint},phase:stable,snapshot:fresh}`] = ['count>0'];
  }
}
export const options = {
  setupTimeout: '30m',
  scenarios: { authenticated_navigation: COLD
    ? { executor: 'per-vu-iterations', vus: USERS, iterations: Math.min(...FIXTURES.map(f => f.deckIds.length)), maxDuration: HOLD }
    : PROFILE === 'ci'
    ? { executor: 'per-vu-iterations', vus: Math.min(USERS, 5), iterations: 2, maxDuration: '2m' }
    : { executor: 'ramping-vus', startVUs: 0, stages: [
      { duration: RAMP, target: USERS }, { duration: HOLD, target: USERS }, { duration: RAMP, target: 0 },
    ], gracefulRampDown: '30s' } },
  thresholds,
  summaryTrendStats: ['count', 'min', 'avg', 'med', 'p(95)', 'p(99)', 'max'],
};
function milliseconds(value) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value);
  if (!match) throw new Error(`Invalid duration ${value}`);
  return Number(match[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000 })[match[2]];
}
function phase() {
  if (PROFILE === 'ci' || COLD) return 'stable';
  const elapsed = Date.now() - execution.scenario.startTime;
  return elapsed < milliseconds(RAMP) ? 'ramp_up' : elapsed < milliseconds(RAMP) + milliseconds(HOLD) ? 'stable' : 'ramp_down';
}
function params(token, endpoint, stage = phase()) {
  return { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, tags: { endpoint, phase: stage }, timeout: '15s' };
}
function body(response) { try { return response.json(); } catch (_) { return null; } }
function observe(response, endpoint, stage, analysis = false) {
  const data = body(response);
  const failed = response.status !== 200 || data === null;
  const snapshot = analysis ? (data?.snapshot?.hit === true ? 'fresh' : 'cold') : 'none';
  const tags = { endpoint, phase: stage, snapshot, traffic_type: analysis ? 'deck_analysis' : 'light_read',
    visit: execution.vu.iterationInScenario === 0 ? 'first' : 'repeat' };
  duration.add(response.timings.duration, tags); errors.add(failed, tags); requests.add(1, tags);
  bytes.add(unescape(encodeURIComponent(response.body || '')).length, tags);
  check(response, { [`${endpoint} succeeds`]: () => !failed }, tags);
  return data;
}
function read(path, endpoint, user, analysis = false) {
  const stage = phase();
  return observe(http.get(`${API}${path}`, params(user.token, endpoint, stage)), endpoint, stage, analysis);
}
function analysisPath(user) {
  return `/decks/${user.deckId}/analysis${user.kind === 'advanced' ? '/advanced' : user.kind === 'bracket' ? '?view=bracket' : ''}`;
}
export function setup() {
  if (!__ENV.USER_PASSWORD) throw new Error('USER_PASSWORD is required');
  const users = [];
  for (let i = 1; i <= USERS; ++i) {
    const login = http.post(`${API}/auth/login`, JSON.stringify({ email: `test${String(i).padStart(2, '0')}@test.com`, password: __ENV.USER_PASSWORD }), {
      headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'auth_login', phase: 'setup' },
    });
    const token = body(login)?.token;
    if (login.status !== 200 || !token) throw new Error(`Test-account login failed (${i}, HTTP ${login.status})`);
    const user = { token };
    if (MIX === 'web') {
      const response = http.get(`${API}/decks?limit=1`, params(token, 'web_fixture', 'setup'));
      user.deckId = body(response)?.data?.[0]?.id;
      if (response.status !== 200 || !user.deckId) throw new Error(`Web fixture missing for account ${i}`);
    }
    const kind = MIX === 'mixed' ? (i % 10 === 0 ? 'advanced' : i % 10 === 9 ? 'basic' : null) : MIX in analyses ? MIX : null;
    if (kind) {
      const decks = body(http.get(`${API}/decks?limit=1`, params(token, 'analysis_fixture', 'setup')));
      user.deckId = decks?.data?.[0]?.id;
      if (!user.deckId) throw new Error(`Analysis fixture missing for account ${i}`);
      user.kind = kind;
      if (COLD) {
        const fixture = FIXTURES.find(f => f.email === `test${String(i).padStart(2, '0')}@test.com`);
        if (!fixture?.deckIds?.length) throw new Error(`Cold fixture missing (${i})`);
        user.deckIds = fixture.deckIds;
      }
      if ((__ENV.ANALYSIS_STATE || 'warm') === 'warm') {
        if (http.get(`${API}${analysisPath(user)}`, params(token, analyses[kind], 'setup')).status !== 200) throw new Error(`Analysis warm-up failed (${i})`);
      }
    }
    users.push(user);
  }
  return { users };
}
export default function (data) {
  const user = data.users[(__VU - 1) % data.users.length];
  if (MIX === 'web') {
    const paths = [...webReads.slice(0, 3),
      [`/decks/${user.deckId}`, 'deck_detail'], [`/decks/${user.deckId}/sections`, 'deck_sections'],
      ...webReads.slice(3)];
    for (const [path, endpoint] of paths) {
      const result = read(path, endpoint, user);
      if (endpoint.startsWith('cards_search_') && endpoint !== 'cards_search_options') {
        incomplete.add(!Array.isArray(result?.data));
      }
      // Pace individual actions instead of firing the whole browsing journey at once.
      sleep(1);
    }
  } else if (user.kind) {
    if (COLD) user.deckId = user.deckIds[execution.vu.iterationInScenario];
    const result = read(analysisPath(user), analyses[user.kind], user, true);
    if (COLD) incomplete.add(result?.snapshot?.hit !== false);
  }
  else {
    for (const [path, endpoint] of navigation) read(path, endpoint, user);
    if (MIX === 'panels') {
      read('/friends', 'friends', user); read('/messages', 'messages', user);
      const stage = phase();
      const results = http.batch(TERMS.map(term => ({ method: 'GET', url: `${API}/friends/search?q=${encodeURIComponent(term)}`, params: params(user.token, 'friends_search', stage) })));
      for (const response of results) {
        const data = observe(response, 'friends_search', stage);
        incomplete.add(!Array.isArray(data?.data) || data.data.length > 8);
      }
    }
  }
  incomplete.add(false);
  sleep(Number.parseFloat(__ENV.THINK_SECONDS || '1'));
}
export function handleSummary(data) {
  return { '/reports/k6-summary.json': JSON.stringify(data, null, 2),
    '/reports/navigation-report.json': JSON.stringify({ generatedAt: new Date().toISOString(), mix: MIX, users: USERS,
      commit: __ENV.DEPLOYED_COMMIT || 'unverified', profile: PROFILE, analysisState: __ENV.ANALYSIS_STATE || 'warm', metrics: data.metrics }, null, 2),
    stdout: `Navigation report: ${MIX}, ${USERS} users; endpoint gates exported to /reports.\n` };
}
