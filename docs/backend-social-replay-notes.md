# Backend Social, Spectator and Replay Notes

These are planned backend capabilities, not MVP requirements.

## Friendships

Planned model: `Friendship`.

Suggested fields:

- `id`
- `requester`
- `recipient`
- `status`: `pending`, `accepted`, `blocked`
- `createdAt`
- `updatedAt`

Initial API shape:

- `GET /friends`
- `POST /friends/requests`
- `POST /friends/requests/{id}/accept`
- `POST /friends/requests/{id}/decline`
- `DELETE /friends/{id}`
- `POST /friends/{id}/block`

Friendships should later drive room invites, presence, direct messages and quick table setup.

## Spectator Mode

Planned model: `GameSpectator`.

Suggested fields:

- `id`
- `game`
- `user`
- `role`: `spectator`, `commentator`, `judge`
- `createdAt`

Initial behavior:

- Room owner controls whether spectators are allowed.
- Spectators can read snapshots/events.
- Spectators cannot execute game commands.
- Commentators may later have a separate chat scope.

## Replay Mode

Current foundation:

- `GameEvent` already stores ordered game commands.
- `GET /games/{id}/events` already exposes event history to participants.

Future additions:

- Store periodic `GameSnapshot` checkpoints.
- Add `GET /games/{id}/replay`.
- Add replay visibility separate from live game visibility.
- Allow public replay links for tournament/streaming use.

## Localization

Platform localization should be handled by the frontend i18n layer.

Card localization should come from imported Scryfall data:

- `lang`
- `printedName`
- `flavorName`

The backend should not call Scryfall live per request for localization.

## Legal/IP Notes

Before public launch, add a visible unofficial fan content notice:

```text
CommanderZone is unofficial Fan Content permitted under the Fan Content Policy.
Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast.
© Wizards of the Coast LLC.
```

Do not store or redistribute bulk image binaries unless the legal/compliance position is reviewed.
Prefer returning Scryfall image URIs or redirects for card images.
