# AGENTS.md

## Project

Angular frontend for CommanderZone, a Magic: The Gathering Commander web app.

## Rules

- Keep the frontend under this `/frontend` directory.
- Do not modify `../backend` unless an API contract issue makes it strictly necessary.
- Use strict TypeScript and standalone Angular components.
- Prefer signals for local UI state and RxJS for HTTP/realtime streams.
- Use JWT Bearer auth with `Authorization: Bearer <token>`.
- Local API base: `http://127.0.0.1:8000`.
- Local Mercure URL: `http://127.0.0.1:3000/.well-known/mercure`.
- Do not implement a Magic rules engine in the frontend.
- Keep the game table dense, functional and desktop-first.
