<?php

namespace App\Application\Game\WebSocket;

use App\Application\Card\CardLocalizedPayloadResolver;
use Doctrine\DBAL\Connection;
use Psr\Log\LoggerInterface;

/**
 * Builds localized card payloads for WebSocket projections without hydrating ORM entities.
 */
final class GameWebsocketCardLocalizationResolver
{
    private const LOOKUP_PRESSURE_THRESHOLD_MS = 400;

    private CardLocalizedPayloadResolver $localizedPayloadResolver;

    public function __construct(
        Connection $connection,
        private readonly ?LoggerInterface $logger = null,
        ?CardLocalizedPayloadResolver $localizedPayloadResolver = null,
    )
    {
        $this->localizedPayloadResolver = $localizedPayloadResolver ?? new CardLocalizedPayloadResolver($connection);
    }

    /**
     * @param list<string> $requestedLanguages
     *
     * @return array<string,array<string,array<string,mixed>>>
     */
    public function buildLocalizedLookup(array $previousSnapshot, array $nextSnapshot, array $requestedLanguages): array
    {
        $startedAt = microtime(true);
        $sourceIds = $this->changedSnapshotScryfallIds($previousSnapshot, $nextSnapshot);
        if ($sourceIds === []) {
            return [];
        }

        $localizedLookup = $this->localizedPayloadResolver->buildLocalizedImageLookupForScryfallIds(
            $sourceIds,
            $requestedLanguages,
        );

        $elapsedMs = (microtime(true) - $startedAt) * 1000;
        if ($elapsedMs > self::LOOKUP_PRESSURE_THRESHOLD_MS) {
            $this->logger?->info('WS card localization lookup pressure detected.', [
                'elapsedMs' => round($elapsedMs, 2),
                'sourceCount' => count($sourceIds),
                'languageCount' => count($localizedLookup),
            ]);
        }

        return $localizedLookup;
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return list<string>
     */
    private function changedSnapshotScryfallIds(array $previousSnapshot, array $nextSnapshot): array
    {
        $previousCards = $this->snapshotCardsByStableId($previousSnapshot);
        $nextCards = $this->snapshotCardsByStableId($nextSnapshot);
        $sourceIds = [];

        foreach (array_unique([...array_keys($previousCards), ...array_keys($nextCards)]) as $stableId) {
            $previousCard = $previousCards[$stableId] ?? null;
            $nextCard = $nextCards[$stableId] ?? null;
            if ($previousCard === $nextCard) {
                continue;
            }

            foreach ([$previousCard, $nextCard] as $cardEntry) {
                if (!is_array($cardEntry)) {
                    continue;
                }

                $scryfallId = trim((string) (($cardEntry['card']['scryfallId'] ?? null) ?? ''));
                if ($scryfallId !== '') {
                    $sourceIds[$scryfallId] = true;
                }
            }
        }

        return array_keys($sourceIds);
    }

    /**
     * @param array<string,mixed> $snapshot
     *
     * @return array<string,array{card: array<string,mixed>, slot: string}>
     */
    private function snapshotCardsByStableId(array $snapshot): array
    {
        $cardsByStableId = [];
        $players = $snapshot['players'] ?? null;
        if (!is_array($players)) {
            return [];
        }

        foreach ($players as $playerId => $player) {
            if (!is_array($player) || !is_array($player['zones'] ?? null)) {
                continue;
            }

            foreach ($player['zones'] as $zone => $cards) {
                if (!is_array($cards)) {
                    continue;
                }

                foreach (array_values($cards) as $index => $card) {
                    if (!is_array($card)) {
                        continue;
                    }

                    $instanceId = trim((string) ($card['instanceId'] ?? ''));
                    if ($instanceId === '') {
                        $instanceId = sprintf(
                            '%s|%s|%d|%s',
                            (string) $playerId,
                            (string) $zone,
                            $index,
                            trim((string) ($card['scryfallId'] ?? '')),
                        );
                    }

                    $cardsByStableId[$instanceId] = [
                        'card' => $card,
                        'slot' => sprintf('%s|%s|%d', (string) $playerId, (string) $zone, $index),
                    ];
                }
            }
        }

        foreach (($snapshot['specialEntities'] ?? []) as $entity) {
            if (!is_array($entity) || !is_array($entity['card'] ?? null)) {
                continue;
            }

            $entityId = trim((string) ($entity['id'] ?? ''));
            if ($entityId === '') {
                continue;
            }

            $cardsByStableId['special-entity:'.$entityId] = [
                'card' => $entity['card'],
                'slot' => 'special-entity:'.$entityId,
            ];
        }

        return $cardsByStableId;
    }

}
