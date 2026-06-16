<?php

namespace App\Application\Game;

use App\Domain\User\User;
use Symfony\Component\Uid\Uuid;

final class GameSpecialEntityCommandHandler
{
    private const DAY_NIGHT_CARD_NAME = 'Day // Night';
    private const DAY_NIGHT_CARD_LAYOUT = 'double_faced_token';
    private const DAY_NIGHT_FIXED_POSITION = ['x' => 1, 'y' => 0, 'unit' => 'ratio'];
    private const COMMANDS = [
        'helper.created',
        'helper.updated',
        'helper.removed',
    ];
    private const TEMPLATES = [
        'monarch',
        'initiative',
        'citys_blessing',
        'day_night',
        'the_ring',
        'emblem',
        'dungeon',
    ];
    private const PLAYER_TEMPLATES = ['citys_blessing', 'the_ring', 'emblem', 'dungeon'];
    private const CARD_BACKED_TEMPLATES = ['emblem', 'dungeon'];
    private const OPTIONAL_CARD_TEMPLATES = ['day_night', 'monarch', 'citys_blessing'];

    /**
     * @return list<string>
     */
    public static function supportedCommands(): array
    {
        return self::COMMANDS;
    }

    public function supports(string $type): bool
    {
        return in_array($type, self::COMMANDS, true);
    }

    /**
     * @return array{log: string|null, eventPayload: array<string,mixed>}
     */
    public function apply(array &$snapshot, string $type, array $payload, User $actor): array
    {
        $snapshot['specialEntities'] = $this->normalizeEntities($snapshot, $snapshot['specialEntities'] ?? []);

        return match ($type) {
            'helper.created' => $this->applyCreated($snapshot, $payload, $actor),
            'helper.updated' => $this->applyUpdated($snapshot, $payload, $actor),
            'helper.removed' => $this->applyRemoved($snapshot, $payload, $actor),
            default => throw new \InvalidArgumentException(sprintf('Unknown helper command: %s', $type)),
        };
    }

    public function normalizeSnapshot(array $snapshot): array
    {
        $snapshot['specialEntities'] = $this->normalizeEntities($snapshot, $snapshot['specialEntities'] ?? []);

        return $snapshot;
    }

    public function assertActorCanApply(array $snapshot, string $type, array $payload, User $actor): void
    {
        $actorId = $actor->id();
        $actorPlayerId = $this->actorPlayerId($snapshot, $actorId);
        $snapshot['specialEntities'] = $this->normalizeEntities($snapshot, $snapshot['specialEntities'] ?? []);

        if ($type === 'helper.created') {
            $template = $this->requiredTemplate($payload);
            $ownerPlayerId = $this->normalizedOwnerFromPayload($snapshot, $payload, $actorId, $template);
            if ($template === 'day_night' && $actorPlayerId === null) {
                throw new \InvalidArgumentException('Only players can change day/night.');
            }
            if ($template === 'monarch' && $this->canActorCreateMonarch($snapshot, $actorPlayerId, $ownerPlayerId)) {
                return;
            }
            if ($template !== 'day_night' && ($actorPlayerId === null || $ownerPlayerId !== $actorPlayerId)) {
                throw new \InvalidArgumentException('You can only create helpers for your own player.');
            }

            return;
        }

        $entityId = trim((string) ($payload['entityId'] ?? ''));
        if ($entityId === '') {
            throw new \InvalidArgumentException('Helper entityId is required.');
        }

        $entity = $this->findEntity($snapshot, $entityId);
        if ($entity === null) {
            throw new \InvalidArgumentException('Helper entity was not found.');
        }

        if (($entity['template'] ?? null) === 'day_night') {
            if ($actorPlayerId === null) {
                throw new \InvalidArgumentException('Only players can change day/night.');
            }
            if ($type === 'helper.removed' && !$this->canActorRemoveDayNight($snapshot, $entity, $actorId)) {
                throw new \InvalidArgumentException('Only the player who created day/night can remove it.');
            }

            return;
        }

        if (!$this->canActorControlEntity($snapshot, $entity, $actorId)) {
            throw new \InvalidArgumentException('You can only change your own helpers.');
        }
    }

    /**
     * @param mixed $entities
     *
     * @return list<array<string,mixed>>
     */
    private function normalizeEntities(array $snapshot, mixed $entities): array
    {
        if (!is_array($entities)) {
            return [];
        }

        $normalized = [];
        $singletonIndexes = [];

        foreach ($entities as $entity) {
            if (!is_array($entity)) {
                continue;
            }

            $normalizedEntity = $this->normalizeEntity($snapshot, $entity);
            if ($normalizedEntity === null) {
                continue;
            }

            $singletonKey = $this->singletonKey($normalizedEntity);
            if ($singletonKey !== null) {
                $existingIndex = $singletonIndexes[$singletonKey] ?? null;
                if (is_int($existingIndex)) {
                    $normalized[$existingIndex] = $normalizedEntity;
                    continue;
                }

                $singletonIndexes[$singletonKey] = count($normalized);
            }

            $normalized[] = $normalizedEntity;
        }

        return array_values(array_map(
            fn (array $entity): array => $this->sanitizeEntityState($snapshot, $entity),
            $normalized,
        ));
    }

    /**
     * @param array<string,mixed> $entity
     *
     * @return array<string,mixed>|null
     */
    private function normalizeEntity(array $snapshot, array $entity): ?array
    {
        $template = trim((string) ($entity['template'] ?? ''));
        if (!in_array($template, self::TEMPLATES, true)) {
            return null;
        }

        $ownerPlayerId = $this->normalizedOwnerPlayerId($snapshot, $entity['ownerPlayerId'] ?? null, $template);
        if ($this->templateRequiresOwner($template) && $ownerPlayerId === null) {
            return null;
        }

        $card = $this->normalizeCardRef($template, $entity['card'] ?? null);
        if (in_array($template, self::CARD_BACKED_TEMPLATES, true) && $card === null) {
            return null;
        }

        return $this->sanitizeEntityState($snapshot, [
            'id' => $this->nonEmptyString($entity['id'] ?? null) ?? Uuid::v7()->toRfc4122(),
            'template' => $template,
            'scope' => $this->scopeForTemplate($template),
            'ownerPlayerId' => $ownerPlayerId,
            'card' => $card,
            'state' => $this->normalizeState($template, $entity['state'] ?? []),
            'createdAt' => $this->normalizedDateTime($entity['createdAt'] ?? null),
        ]);
    }

    /**
     * @return array{log: string|null, eventPayload: array<string,mixed>}
     */
    private function applyCreated(array &$snapshot, array $payload, User $actor): array
    {
        $template = $this->requiredTemplate($payload);
        $state = is_array($payload['state'] ?? null) ? $payload['state'] : [];
        if ($template === 'day_night') {
            $actorPlayerId = $this->actorPlayerId($snapshot, $actor->id());
            if ($actorPlayerId === null) {
                throw new \InvalidArgumentException('Only players can change day/night.');
            }

            $state['createdByPlayerId'] = $actorPlayerId;
        }

        $entity = $this->normalizeEntity($snapshot, [
            'template' => $template,
            'ownerPlayerId' => $this->normalizedOwnerFromPayload($snapshot, $payload, $actor->id(), $template),
            'card' => $payload['card'] ?? null,
            'state' => $state,
            'createdAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
        ]);
        if ($entity === null) {
            throw new \InvalidArgumentException('Helper payload is invalid.');
        }

        $specialEntities = $this->removeConflictingEntities($snapshot, $snapshot['specialEntities'] ?? [], $entity);
        $specialEntities[] = $entity;
        $snapshot['specialEntities'] = $this->normalizeEntities($snapshot, $specialEntities);
        $createdEntity = $this->findEntity($snapshot, (string) $entity['id']) ?? $entity;
        if (($createdEntity['template'] ?? null) === 'day_night') {
            $this->syncDayNightBattlefieldCards($snapshot, $createdEntity);
        }

        return [
            'log' => $this->createdMessage($snapshot, $createdEntity),
            'eventPayload' => [
                'template' => $createdEntity['template'],
                'ownerPlayerId' => $createdEntity['ownerPlayerId'],
                'card' => $createdEntity['card'],
                'state' => $createdEntity['state'],
            ],
        ];
    }

    /**
     * @return array{log: string|null, eventPayload: array<string,mixed>}
     */
    private function applyUpdated(array &$snapshot, array $payload, User $actor): array
    {
        $entityId = trim((string) ($payload['entityId'] ?? ''));
        $entityIndex = $this->findEntityIndex($snapshot, $entityId);
        if ($entityIndex === null) {
            throw new \InvalidArgumentException('Helper entity was not found.');
        }

        $entity = $snapshot['specialEntities'][$entityIndex];
        if (($entity['template'] ?? null) === 'day_night' && $this->actorPlayerId($snapshot, $actor->id()) === null) {
            throw new \InvalidArgumentException('Only players can change day/night.');
        }
        if (($entity['template'] ?? null) !== 'day_night' && !$this->canActorControlEntity($snapshot, $entity, $actor->id())) {
            throw new \InvalidArgumentException('You can only change your own helpers.');
        }

        $state = $payload['state'] ?? [];
        if (($entity['template'] ?? null) === 'day_night') {
            $state = $this->mergedDayNightUpdateState($entity['state'] ?? [], $state);
            if ($this->nonEmptyString($state['createdByPlayerId'] ?? null) === null) {
                $state['createdByPlayerId'] = $this->actorPlayerId($snapshot, $actor->id());
            }

            $card = $this->normalizeCardRef('day_night', $payload['card'] ?? null);
            if ($card !== null) {
                $entity['card'] = $card;
            }
        }

        $entity['state'] = $this->normalizeState((string) $entity['template'], $state);
        $snapshot['specialEntities'][$entityIndex] = $entity;
        $snapshot['specialEntities'] = $this->normalizeEntities($snapshot, $snapshot['specialEntities']);
        $updatedEntity = $this->findEntity($snapshot, $entityId);
        if ($updatedEntity === null) {
            throw new \InvalidArgumentException('Helper entity was not found.');
        }
        if (($updatedEntity['template'] ?? null) === 'day_night') {
            $this->syncDayNightBattlefieldCards($snapshot, $updatedEntity);
        }

        return [
            'log' => $this->updatedMessage($snapshot, $updatedEntity),
            'eventPayload' => [
                'entityId' => $entityId,
                'state' => $updatedEntity['state'],
            ],
        ];
    }

    /**
     * @return array{log: string|null, eventPayload: array<string,mixed>}
     */
    private function applyRemoved(array &$snapshot, array $payload, User $actor): array
    {
        $entityId = trim((string) ($payload['entityId'] ?? ''));
        $entityIndex = $this->findEntityIndex($snapshot, $entityId);
        if ($entityIndex === null) {
            throw new \InvalidArgumentException('Helper entity was not found.');
        }

        $entity = $snapshot['specialEntities'][$entityIndex];
        if (($entity['template'] ?? null) === 'day_night') {
            if (!$this->canActorRemoveDayNight($snapshot, $entity, $actor->id())) {
                throw new \InvalidArgumentException('Only the player who created day/night can remove it.');
            }
        } elseif (!$this->canActorControlEntity($snapshot, $entity, $actor->id())) {
            throw new \InvalidArgumentException('You can only change your own helpers.');
        }

        array_splice($snapshot['specialEntities'], $entityIndex, 1);
        if (($entity['template'] ?? null) === 'day_night') {
            $this->removeDayNightBattlefieldCards($snapshot);
        }
        $snapshot['specialEntities'] = $this->normalizeEntities($snapshot, $snapshot['specialEntities']);

        return [
            'log' => $this->removedMessage($entity),
            'eventPayload' => ['entityId' => $entityId],
        ];
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function removeConflictingEntities(array $snapshot, array $entities, array $candidate): array
    {
        $conflictKey = $this->singletonKey($candidate);
        if ($conflictKey === null) {
            return $entities;
        }

        return array_values(array_filter(
            $this->normalizeEntities($snapshot, $entities),
            fn (array $entity): bool => $this->singletonKey($entity) !== $conflictKey,
        ));
    }

    private function requiredTemplate(array $payload): string
    {
        $template = trim((string) ($payload['template'] ?? ''));
        if (!in_array($template, self::TEMPLATES, true)) {
            throw new \InvalidArgumentException('Helper template is invalid.');
        }

        return $template;
    }

    private function normalizedOwnerFromPayload(array $snapshot, array $payload, string $actorId, string $template): ?string
    {
        if ($template === 'day_night') {
            return null;
        }

        $ownerPlayerId = $this->normalizedOwnerPlayerId($snapshot, $payload['ownerPlayerId'] ?? $actorId, $template);

        return $ownerPlayerId ?? $this->actorPlayerId($snapshot, $actorId);
    }

    private function scopeForTemplate(string $template): string
    {
        return in_array($template, self::PLAYER_TEMPLATES, true) ? 'player' : 'global';
    }

    private function templateRequiresOwner(string $template): bool
    {
        return in_array($template, self::PLAYER_TEMPLATES, true);
    }

    private function normalizedOwnerPlayerId(array $snapshot, mixed $ownerPlayerId, string $template): ?string
    {
        if ($template === 'day_night') {
            return null;
        }

        return $this->resolveSnapshotPlayerId($snapshot, $this->nonEmptyString($ownerPlayerId));
    }

    /**
     * @return array<string,mixed>|null
     */
    private function normalizeCardRef(string $template, mixed $card): ?array
    {
        if (!in_array($template, [...self::CARD_BACKED_TEMPLATES, ...self::OPTIONAL_CARD_TEMPLATES], true)) {
            return null;
        }

        if (!is_array($card)) {
            return null;
        }

        $scryfallId = $this->nonEmptyString($card['scryfallId'] ?? null);
        $name = $this->nonEmptyString($card['name'] ?? null);
        if ($scryfallId === null || $name === null) {
            return null;
        }

        return [
            'scryfallId' => $scryfallId,
            'name' => $name,
            'imageUris' => is_array($card['imageUris'] ?? null) ? $card['imageUris'] : [],
            'cardFaces' => $this->normalizeCardFaces($card['cardFaces'] ?? []),
            'typeLine' => is_string($card['typeLine'] ?? null) ? $card['typeLine'] : null,
            'oracleText' => is_string($card['oracleText'] ?? null) ? $card['oracleText'] : null,
            'layout' => is_string($card['layout'] ?? null) ? $card['layout'] : null,
        ];
    }

    /**
     * @return list<array<string,mixed>>
     */
    private function normalizeCardFaces(mixed $faces): array
    {
        if (!is_array($faces)) {
            return [];
        }

        $normalized = [];
        foreach ($faces as $face) {
            if (!is_array($face)) {
                continue;
            }

            $normalized[] = [
                'name' => $this->nonEmptyString($face['name'] ?? null),
                'manaCost' => is_string($face['manaCost'] ?? null) ? $face['manaCost'] : $this->nonEmptyString($face['mana_cost'] ?? null),
                'typeLine' => is_string($face['typeLine'] ?? null) ? $face['typeLine'] : $this->nonEmptyString($face['type_line'] ?? null),
                'oracleText' => is_string($face['oracleText'] ?? null) ? $face['oracleText'] : $this->nonEmptyString($face['oracle_text'] ?? null),
                'power' => $this->nonEmptyString($face['power'] ?? null),
                'toughness' => $this->nonEmptyString($face['toughness'] ?? null),
                'loyalty' => $this->nonEmptyString($face['loyalty'] ?? null),
                'colors' => is_array($face['colors'] ?? null) ? array_values($face['colors']) : [],
                'imageUris' => is_array($face['imageUris'] ?? null)
                    ? $face['imageUris']
                    : (is_array($face['image_uris'] ?? null) ? $face['image_uris'] : []),
            ];
        }

        return $normalized;
    }

    /**
     * @param array<string,mixed> $entity
     */
    private function syncDayNightBattlefieldCards(array &$snapshot, array $entity): void
    {
        $card = $this->normalizeCardRef('day_night', $entity['card'] ?? null);
        if ($card === null || !$this->isDayNightCardRef($card)) {
            return;
        }

        $state = is_array($entity['state'] ?? null) ? $entity['state'] : [];
        $mode = ($state['mode'] ?? null) === 'night' ? 'night' : 'day';
        $createdByPlayerId = $this->nonEmptyString($state['createdByPlayerId'] ?? null) ?? $this->firstSnapshotPlayerId($snapshot);

        foreach ($this->snapshotPlayerIds($snapshot) as $playerId) {
            $battlefield =& $snapshot['players'][$playerId]['zones']['battlefield'];
            if (!is_array($battlefield)) {
                $battlefield = [];
            }

            $existingIndex = $this->dayNightBattlefieldCardIndex($battlefield);
            $position = $this->defaultRatioPosition();
            if ($existingIndex === null) {
                $battlefield[] = $this->dayNightBattlefieldCard($card, $createdByPlayerId ?? $playerId, $playerId, $mode, $position);
                unset($battlefield);
                continue;
            }

            $existing = is_array($battlefield[$existingIndex]) ? $battlefield[$existingIndex] : [];
            $battlefield[$existingIndex] = [
                ...$this->dayNightBattlefieldCard($card, $createdByPlayerId ?? $playerId, $playerId, $mode, $position),
                'instanceId' => $this->nonEmptyString($existing['instanceId'] ?? null) ?? Uuid::v7()->toRfc4122(),
                'counters' => is_array($existing['counters'] ?? null) ? $existing['counters'] : [],
            ];
            unset($battlefield);
        }
    }

    private function removeDayNightBattlefieldCards(array &$snapshot): void
    {
        foreach ($this->snapshotPlayerIds($snapshot) as $playerId) {
            $battlefield = $snapshot['players'][$playerId]['zones']['battlefield'] ?? [];
            if (!is_array($battlefield)) {
                continue;
            }

            $snapshot['players'][$playerId]['zones']['battlefield'] = array_values(array_filter(
                $battlefield,
                fn (mixed $card): bool => !$this->isDayNightBattlefieldCard($card),
            ));
        }
    }

    /**
     * @param array<string,mixed> $card
     * @param array{x: float|int, y: float|int, unit: string} $position
     *
     * @return array<string,mixed>
     */
    private function dayNightBattlefieldCard(array $card, string $ownerPlayerId, string $controllerPlayerId, string $mode, array $position): array
    {
        return [
            'instanceId' => Uuid::v7()->toRfc4122(),
            'ownerId' => $ownerPlayerId,
            'controllerId' => $controllerPlayerId,
            'scryfallId' => $card['scryfallId'],
            'name' => $card['name'],
            'imageUris' => $card['imageUris'] ?? [],
            'cardFaces' => $card['cardFaces'] ?? [],
            'typeLine' => $card['typeLine'] ?? 'Card // Card',
            'manaCost' => null,
            'oracleText' => $card['oracleText'] ?? null,
            'colorIdentity' => [],
            'power' => null,
            'toughness' => null,
            'loyalty' => null,
            'defaultPower' => null,
            'defaultToughness' => null,
            'defaultLoyalty' => null,
            'tapped' => false,
            'faceDown' => false,
            'activeFaceIndex' => $mode === 'night' ? 1 : 0,
            'revealedTo' => [],
            'position' => $position,
            'rotation' => 0,
            'counters' => [],
            'zone' => 'battlefield',
            'isToken' => true,
            'isTokenCopy' => false,
            'isCommander' => false,
            'layout' => self::DAY_NIGHT_CARD_LAYOUT,
        ];
    }

    /**
     * @param list<mixed> $battlefield
     */
    private function dayNightBattlefieldCardIndex(array $battlefield): ?int
    {
        foreach ($battlefield as $index => $card) {
            if ($this->isDayNightBattlefieldCard($card)) {
                return (int) $index;
            }
        }

        return null;
    }

    private function isDayNightBattlefieldCard(mixed $card): bool
    {
        return is_array($card)
            && $this->isDayNightCardRef($card);
    }

    /**
     * @param array<string,mixed> $card
     */
    private function isDayNightCardRef(array $card): bool
    {
        return trim((string) ($card['name'] ?? '')) === self::DAY_NIGHT_CARD_NAME
            && trim((string) ($card['layout'] ?? '')) === self::DAY_NIGHT_CARD_LAYOUT;
    }

    /**
     * @return array<string,mixed>
     */
    private function normalizeState(string $template, mixed $state): array
    {
        $state = is_array($state) ? $state : [];

        return match ($template) {
            'day_night' => [
                'mode' => ($state['mode'] ?? null) === 'night' ? 'night' : 'day',
                'createdByPlayerId' => $this->nonEmptyString($state['createdByPlayerId'] ?? null),
                'positions' => $this->normalizeDayNightPositions($state['positions'] ?? []),
            ],
            'the_ring' => [
                'level' => max(1, min(4, (int) ($state['level'] ?? 1))),
                'ringBearerInstanceId' => $this->nonEmptyString($state['ringBearerInstanceId'] ?? null),
            ],
            'dungeon' => [
                'roomIndex' => isset($state['roomIndex']) && is_numeric($state['roomIndex']) ? max(0, (int) $state['roomIndex']) : null,
                'roomName' => $this->nonEmptyString($state['roomName'] ?? null),
            ],
            default => [],
        };
    }

    /**
     * @param array<string,mixed> $entity
     *
     * @return array<string,mixed>
     */
    private function sanitizeEntityState(array $snapshot, array $entity): array
    {
        if (($entity['template'] ?? null) === 'day_night') {
            $entity['state'] = $this->sanitizeDayNightState($snapshot, $entity);

            return $entity;
        }

        if (($entity['template'] ?? null) !== 'the_ring') {
            return $entity;
        }

        $ownerPlayerId = $this->nonEmptyString($entity['ownerPlayerId'] ?? null);
        $ringBearerInstanceId = $this->nonEmptyString($entity['state']['ringBearerInstanceId'] ?? null);
        if ($ownerPlayerId === null || $ringBearerInstanceId === null) {
            $entity['state']['ringBearerInstanceId'] = null;

            return $entity;
        }

        $ringBearer = $this->findBattlefieldCard($snapshot, $ringBearerInstanceId);
        if ($ringBearer === null || ($ringBearer['controllerId'] ?? null) !== $ownerPlayerId) {
            $entity['state']['ringBearerInstanceId'] = null;
        }

        return $entity;
    }

    /**
     * @param array<string,mixed> $entity
     *
     * @return array<string,mixed>
     */
    private function sanitizeDayNightState(array $snapshot, array $entity): array
    {
        $state = is_array($entity['state'] ?? null) ? $entity['state'] : [];
        $createdByPlayerId = $this->resolveSnapshotPlayerId(
            $snapshot,
            $this->nonEmptyString($state['createdByPlayerId'] ?? null),
        ) ?? $this->firstSnapshotPlayerId($snapshot);
        $positions = [];

        foreach ($this->snapshotPlayerIds($snapshot) as $playerId) {
            $positions[$playerId] = $this->defaultRatioPosition();
        }

        return [
            'mode' => ($state['mode'] ?? null) === 'night' ? 'night' : 'day',
            'createdByPlayerId' => $createdByPlayerId,
            'positions' => $positions,
        ];
    }

    /**
     * @return array<string,array{x: float|int, y: float|int, unit: string}>
     */
    private function normalizeDayNightPositions(mixed $positions): array
    {
        if (!is_array($positions)) {
            return [];
        }

        $normalized = [];
        foreach ($positions as $playerId => $position) {
            $normalizedPlayerId = $this->nonEmptyString($playerId);
            if ($normalizedPlayerId === null || !is_array($position)) {
                continue;
            }

            $normalized[$normalizedPlayerId] = $this->normalizeRatioPosition($position);
        }

        return $normalized;
    }

    /**
     * @param array<string,mixed> $position
     *
     * @return array{x: float|int, y: float|int, unit: string}
     */
    private function normalizeRatioPosition(array $position): array
    {
        return [
            'x' => $this->clampRatio($position['x'] ?? 0),
            'y' => $this->clampRatio($position['y'] ?? 0),
            'unit' => 'ratio',
        ];
    }

    /**
     * @return array{x: int, y: int, unit: string}
     */
    private function defaultRatioPosition(): array
    {
        return self::DAY_NIGHT_FIXED_POSITION;
    }

    private function clampRatio(mixed $value): float|int
    {
        if (!is_numeric($value)) {
            return 0;
        }

        return max(0, min(1, (float) $value));
    }

    /**
     * @return list<string>
     */
    private function snapshotPlayerIds(array $snapshot): array
    {
        $players = $snapshot['players'] ?? null;
        if (!is_array($players)) {
            return [];
        }

        return array_values(array_filter(
            array_map(fn (mixed $playerId): ?string => $this->nonEmptyString($playerId), array_keys($players)),
        ));
    }

    private function firstSnapshotPlayerId(array $snapshot): ?string
    {
        return $this->snapshotPlayerIds($snapshot)[0] ?? null;
    }

    /**
     * @return array<string,mixed>|null
     */
    private function findBattlefieldCard(array $snapshot, string $instanceId): ?array
    {
        foreach (($snapshot['players'] ?? []) as $player) {
            $battlefield = $player['zones']['battlefield'] ?? [];
            if (!is_array($battlefield)) {
                continue;
            }

            foreach ($battlefield as $card) {
                if (is_array($card) && ($card['instanceId'] ?? null) === $instanceId) {
                    return $card;
                }
            }
        }

        return null;
    }

    private function singletonKey(array $entity): ?string
    {
        $template = (string) ($entity['template'] ?? '');
        if (in_array($template, ['monarch', 'initiative', 'day_night'], true)) {
            return $template;
        }

        if (in_array($template, ['citys_blessing', 'the_ring', 'dungeon'], true)) {
            $ownerPlayerId = $this->nonEmptyString($entity['ownerPlayerId'] ?? null);
            if ($ownerPlayerId === null) {
                return $template.':missing-owner';
            }

            return $template.':'.$ownerPlayerId;
        }

        return null;
    }

    /**
     * @return array<string,mixed>|null
     */
    private function findEntity(array $snapshot, string $entityId): ?array
    {
        foreach (($snapshot['specialEntities'] ?? []) as $entity) {
            if (is_array($entity) && ($entity['id'] ?? null) === $entityId) {
                return $entity;
            }
        }

        return null;
    }

    /**
     * @return array<string,mixed>|null
     */
    private function globalEntity(array $snapshot, string $template): ?array
    {
        foreach (($snapshot['specialEntities'] ?? []) as $entity) {
            if (is_array($entity) && ($entity['template'] ?? null) === $template) {
                return $entity;
            }
        }

        return null;
    }

    private function findEntityIndex(array $snapshot, string $entityId): ?int
    {
        foreach (($snapshot['specialEntities'] ?? []) as $index => $entity) {
            if (is_array($entity) && ($entity['id'] ?? null) === $entityId) {
                return $index;
            }
        }

        return null;
    }

    private function canActorRemoveDayNight(array $snapshot, array $entity, string $actorId): bool
    {
        $actorPlayerId = $this->actorPlayerId($snapshot, $actorId);
        $createdByPlayerId = $this->nonEmptyString($entity['state']['createdByPlayerId'] ?? null);

        return $actorPlayerId !== null && $createdByPlayerId !== null && $actorPlayerId === $createdByPlayerId;
    }

    private function canActorCreateMonarch(array $snapshot, ?string $actorPlayerId, ?string $ownerPlayerId): bool
    {
        if ($actorPlayerId === null || $ownerPlayerId === null) {
            return false;
        }

        if ($ownerPlayerId === $actorPlayerId) {
            return true;
        }

        $currentMonarch = $this->globalEntity($snapshot, 'monarch');
        $currentMonarchPlayerId = $this->nonEmptyString($currentMonarch['ownerPlayerId'] ?? null);

        return $currentMonarchPlayerId !== null && $currentMonarchPlayerId === $actorPlayerId;
    }

    /**
     * @param mixed $existingState
     * @param mixed $incomingState
     *
     * @return array<string,mixed>
     */
    private function mergedDayNightUpdateState(mixed $existingState, mixed $incomingState): array
    {
        $existingState = is_array($existingState) ? $existingState : [];
        $incomingState = is_array($incomingState) ? $incomingState : [];
        $existingPositions = is_array($existingState['positions'] ?? null) ? $existingState['positions'] : [];
        $incomingPositions = is_array($incomingState['positions'] ?? null) ? $incomingState['positions'] : [];

        return array_merge($existingState, $incomingState, [
            'createdByPlayerId' => $existingState['createdByPlayerId'] ?? $incomingState['createdByPlayerId'] ?? null,
            'positions' => array_replace($existingPositions, $incomingPositions),
        ]);
    }

    private function canActorControlEntity(array $snapshot, array $entity, string $actorId): bool
    {
        if (($entity['scope'] ?? 'player') === 'global') {
            return true;
        }

        $ownerPlayerId = $this->nonEmptyString($entity['ownerPlayerId'] ?? null);
        $actorPlayerId = $this->actorPlayerId($snapshot, $actorId);

        return $ownerPlayerId !== null && $actorPlayerId !== null && $ownerPlayerId === $actorPlayerId;
    }

    private function actorPlayerId(array $snapshot, string $actorId): ?string
    {
        return $this->resolveSnapshotPlayerId($snapshot, $actorId);
    }

    private function resolveSnapshotPlayerId(array $snapshot, ?string $candidate): ?string
    {
        if ($candidate === null) {
            return null;
        }

        $players = $snapshot['players'] ?? null;
        if (!is_array($players)) {
            return null;
        }

        if (isset($players[$candidate])) {
            return $candidate;
        }

        foreach ($players as $playerId => $player) {
            if (!is_string($playerId) || !is_array($player)) {
                continue;
            }

            $user = is_array($player['user'] ?? null) ? $player['user'] : null;
            if ($this->nonEmptyString($user['id'] ?? null) === $candidate) {
                return $playerId;
            }
        }

        return null;
    }

    private function createdMessage(array $snapshot, array $entity): string
    {
        return match ($entity['template']) {
            'monarch' => 'Became the monarch.',
            'initiative' => 'Took the initiative.',
            'citys_blessing' => 'Got the city\'s blessing.',
            'day_night' => (($entity['state']['mode'] ?? 'day') === 'night') ? 'Set the game to night.' : 'Set the game to day.',
            'the_ring' => 'Created The Ring.',
            'emblem' => sprintf('%s gets emblem %s.', $this->playerName($snapshot, (string) ($entity['ownerPlayerId'] ?? '')), (string) ($entity['card']['name'] ?? '')),
            'dungeon' => sprintf('Entered dungeon %s.', (string) ($entity['card']['name'] ?? '')),
            default => 'Created a helper.',
        };
    }

    private function updatedMessage(array $snapshot, array $entity): string
    {
        return match ($entity['template']) {
            'day_night' => (($entity['state']['mode'] ?? 'day') === 'night') ? 'Set the game to night.' : 'Set the game to day.',
            'the_ring' => $this->ringBearerMessage($snapshot, $entity) ?? 'Updated The Ring.',
            'dungeon' => 'Updated dungeon progress.',
            default => 'Updated a helper.',
        };
    }

    private function removedMessage(array $entity): string
    {
        return match ($entity['template']) {
            'monarch' => 'Removed the monarch designation.',
            'initiative' => 'Removed the initiative designation.',
            'citys_blessing' => 'Removed the city\'s blessing.',
            'day_night' => 'Removed the day/night designation.',
            'the_ring' => 'Removed The Ring.',
            'emblem' => sprintf('Removed emblem %s.', (string) ($entity['card']['name'] ?? '')),
            'dungeon' => sprintf('Removed dungeon %s.', (string) ($entity['card']['name'] ?? '')),
            default => 'Removed a helper.',
        };
    }

    private function ringBearerMessage(array $snapshot, array $entity): ?string
    {
        $ringBearerInstanceId = $this->nonEmptyString($entity['state']['ringBearerInstanceId'] ?? null);
        if ($ringBearerInstanceId === null) {
            return null;
        }

        $card = $this->findBattlefieldCard($snapshot, $ringBearerInstanceId);
        if ($card === null) {
            return null;
        }

        return sprintf('Set %s as Ring-bearer.', (string) ($card['name'] ?? ''));
    }

    private function playerName(array $snapshot, string $playerId): string
    {
        $player = $snapshot['players'][$playerId] ?? null;
        if (!is_array($player)) {
            return 'Player';
        }

        $user = is_array($player['user'] ?? null) ? $player['user'] : [];
        $displayName = trim((string) ($user['displayName'] ?? ''));

        return $displayName !== '' ? $displayName : $playerId;
    }

    private function normalizedDateTime(mixed $value): string
    {
        if (is_string($value)) {
            try {
                return (new \DateTimeImmutable($value))->format(DATE_ATOM);
            } catch (\Throwable) {
            }
        }

        return (new \DateTimeImmutable())->format(DATE_ATOM);
    }

    private function nonEmptyString(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }

        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }
}
