# CommanderZone Frontend

Angular 21 standalone SPA for the CommanderZone manual Commander table.

## Local Development

```bash
npm install
npm start
```

The app runs on `http://localhost:4200` by default and expects:

- API: `http://127.0.0.1:8000`
- Mercure: `http://127.0.0.1:3000/.well-known/mercure`

## Useful Commands

```bash
npm run build
npm test
npm run e2e
npm run e2e:headed
npm run e2e:ui
```

## E2E (Playwright)

Before running E2E tests, ensure all required services are up:

- Frontend running at `http://localhost:4200`
- Backend API running
- PostgreSQL running
- Mercure running
- Backend migrations applied
- The E2E auth helpers create users through real `/auth/register` and `/auth/login` backend endpoints (no dummy auth).

Example backend preparation:

```bash
cd ../backend
APP_ENV=test php bin/console doctrine:migrations:migrate --no-interaction
```

### Random Deck Helper for E2E

Use `frontend/e2e/support/decks.ts` to create a real deck from local DB cards:

```ts
import { createRandomDeckFromDatabase } from './support/decks';

const deck = await createRandomDeckFromDatabase(request, {
  ownerToken: player.token,
  name: `E2E Deck ${runId}`,
  size: 100,
  seed: runId,
});
```

Returned shape:

```ts
{
  deckId: string;
  seed: string;
  commanderCardId?: string;
  cardIds: string[];
  cards: Array<{
    id: string;
    name: string;
    quantity: number;
    role: 'commander' | 'mainboard';
  }>;
}
```

Implementation notes:

- Uses only local backend APIs (`/cards/search` + `/decks/quick-build`).
- No Scryfall or external network usage during E2E.
- Reproducible selection with explicit `seed`.
- If no `commanderLegal` cards are available in local metadata, it falls back to selecting any card as commander for test setup.

## Notes

- Auth uses JWT Bearer tokens stored locally under `commanderzone.jwt`.
- The game table is intentionally manual. It does not implement Magic rules, priority, stack handling, legal move validation, or automatic gameplay.
- Backend contracts are consumed as-is from Symfony.
