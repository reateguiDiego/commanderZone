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
```

## Notes

- Auth uses JWT Bearer tokens stored locally under `commanderzone.jwt`.
- The game table is intentionally manual. It does not implement Magic rules, priority, stack handling, legal move validation, or automatic gameplay.
- Backend contracts are consumed as-is from Symfony.
