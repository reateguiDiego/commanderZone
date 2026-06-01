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
        $sourceIds = array_values(array_unique([
            ...$this->snapshotScryfallIds($previousSnapshot),
            ...$this->snapshotScryfallIds($nextSnapshot),
        ]));
        if ($sourceIds === []) {
            return [];
        }

        $localizedLookup = $this->localizedPayloadResolver->buildLocalizedLookupForScryfallIds(
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
    private function snapshotScryfallIds(array $snapshot): array
    {
        $ids = [];
        $players = $snapshot['players'] ?? null;
        if (!is_array($players)) {
            return [];
        }

        foreach ($players as $player) {
            if (!is_array($player) || !is_array($player['zones'] ?? null)) {
                continue;
            }

            foreach ($player['zones'] as $cards) {
                if (!is_array($cards)) {
                    continue;
                }

                foreach ($cards as $card) {
                    if (!is_array($card)) {
                        continue;
                    }

                    $scryfallId = trim((string) ($card['scryfallId'] ?? ''));
                    if ($scryfallId !== '') {
                        $ids[$scryfallId] = true;
                    }
                }
            }
        }

        return array_keys($ids);
    }
}
