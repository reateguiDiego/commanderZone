import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const API_BASE_URL = (__ENV.API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const USERS = Number.parseInt(__ENV.USERS || '50', 10);
const PASSWORD = __ENV.USER_PASSWORD || '';
const PROFILE = __ENV.PROFILE || 'baseline';
const HOLD = __ENV.DURATION || '5m';
const RAMP = __ENV.RAMP_DURATION || '1m';
const THINK_SECONDS = Number.parseFloat(__ENV.THINK_SECONDS || '1');
const CONTROL_USERS = Number.parseInt(__ENV.CONTROL_USERS || '0', 10);

const endpointDuration = new Trend('cz_navigation_endpoint_ms', true);
const endpointErrors = new Rate('cz_navigation_endpoint_errors');
const endpointRequests = new Counter('cz_navigation_requests');
const responseBytes = new Counter('cz_navigation_response_bytes');

const paths = [
  ['/me', 'me'],
  ['/rooms', 'rooms'],
  ['/rooms/current', 'rooms_current'],
  ['/decks', 'decks'],
  ['/deck-folders', 'deck_folders'],
  ['/friends', 'friends'],
  ['/messages', 'messages'],
  ['/community', 'community'],
  ['/community/decks', 'community_decks'],
];

const scenario = PROFILE === 'ci'
  ? { executor: 'per-vu-iterations', vus: Math.min(USERS, 5), iterations: 2, maxDuration: '2m' }
  : {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: RAMP, target: USERS },
        { duration: HOLD, target: USERS },
        { duration: RAMP, target: 0 },
      ],
      gracefulRampDown: '30s',
    };

export const options = {
  setupTimeout: '20m',
  scenarios: { authenticated_navigation: scenario },
  thresholds: {
    cz_navigation_endpoint_errors: ['rate<0.01'],
    'cz_navigation_endpoint_ms{traffic_type:light_read}': ['p(95)<500', 'p(99)<1000'],
    // Deck analysis is intentionally excluded from the light-read budget.
    'cz_navigation_endpoint_ms{traffic_type:deck_analysis}': ['p(95)<1500', 'p(99)<3000'],
  },
  summaryTrendStats: ['count', 'min', 'avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  if (!PASSWORD) throw new Error('USER_PASSWORD is required');
  const users = [];
  for (let index = 1; index <= USERS; index += 1) {
    const suffix = index < 100 ? String(index).padStart(2, '0') : String(index);
    const email = `test${suffix}@test.com`;
    const response = http.post(`${API_BASE_URL}/auth/login`, JSON.stringify({ email, password: PASSWORD }), {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'auth_login', traffic_type: 'setup' },
    });
    if (response.status !== 200) throw new Error(`Login failed for ${email}: ${response.status}`);
    const token = response.json('token');
    if (!token) throw new Error(`Login returned no token for ${email}`);
    users.push({ email, token, control: index <= CONTROL_USERS });
  }
  return { users };
}

export default function (data) {
  const user = data.users[(__VU - 1) % data.users.length];
  // Navigation never creates rooms or games. CONTROL_USERS only identifies users
  // reserved for a separately invoked gameplay control scenario.
  for (const [path, endpoint] of paths) {
    navigate(path, endpoint, user.token, user.control ? 'control' : 'navigation');
  }
  sleep(THINK_SECONDS);
}

function navigate(path, endpoint, token, cohort) {
  const tags = { endpoint, traffic_type: 'light_read', cohort };
  const response = http.get(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    tags,
  });
  const failed = response.status < 200 || response.status >= 400;
  endpointDuration.add(response.timings.duration, tags);
  endpointErrors.add(failed, tags);
  endpointRequests.add(1, tags);
  responseBytes.add(response.body ? response.body.length : 0, tags);
  check(response, { [`${endpoint} returned success`]: () => !failed }, tags);
}
