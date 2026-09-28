<?php

namespace App\Application\Community;

use App\Application\Card\CardLocalizationService;
use App\Application\Deck\DeckAnalysisDeckHasher;
use App\Domain\Card\Card;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;

final class CommunityStatisticsService
{
    private const PERIOD_LIFETIME = 'lifetime';
    private const LIFETIME_START = '1970-01-01';
    private const TOP_LIMIT = 100;

    public function __construct(
        private readonly Connection $connection,
        private readonly EntityManagerInterface $entityManager,
        private readonly CardLocalizationService $localization,
        private readonly CommunityCache $cache,
        private readonly DeckAnalysisDeckHasher $deckHasher,
    ) {
    }

    /**
     * Adds the compact, immutable statistics delta to the current transaction.
     *
     * This deliberately does not touch leaderboard rows: starting a game must
     * not contend with other game starts or wait for counter upserts.
     */
    public function enqueueRoomStart(Room $room): void
    {
        $deltas = $this->roomStartDeltas($room);
        if ($deltas === []) {
            return;
        }

        $payload = [];
        foreach ($deltas as $key => $quantity) {
            [$format, $metric, $subjectKey] = explode('|', $key, 3);
            $payload[] = [
                'format' => $format,
                'metric' => $metric,
                'subjectKey' => $subjectKey,
                'usages' => $quantity,
            ];
        }

        $this->connection->executeStatement(
            'INSERT INTO community_statistics_outbox (payload_json, created_at) VALUES (CAST(:payload AS JSONB), CURRENT_TIMESTAMP)',
            ['payload' => json_encode(['version' => 1, 'deltas' => $payload], JSON_THROW_ON_ERROR)],
        );
    }

    /**
     * Applies already-validated deltas claimed by the asynchronous outbox
     * processor. This is intentionally the only counter write path.
     *
     * @param array<string,int> $deltas
     */
    public function applyDeltas(array $deltas): void
    {
        $this->upsert($deltas);
    }

    /**
     * @param list<string> $payloads
     * @return array<string,int>
     */
    public function deltasFromOutboxPayloads(array $payloads): array
    {
        $deltas = [];
        foreach ($payloads as $payload) {
            $decoded = json_decode($payload, true, 512, JSON_THROW_ON_ERROR);
            if (!is_array($decoded) || ($decoded['version'] ?? null) !== 1 || !is_array($decoded['deltas'] ?? null)) {
                throw new \UnexpectedValueException('Invalid community statistics outbox payload.');
            }

            foreach ($decoded['deltas'] as $delta) {
                if (!is_array($delta)) {
                    throw new \UnexpectedValueException('Invalid community statistics outbox delta.');
                }
                $format = $delta['format'] ?? null;
                $metric = $delta['metric'] ?? null;
                $subjectKey = $delta['subjectKey'] ?? null;
                $quantity = $delta['usages'] ?? null;
                if (
                    !is_string($format) || trim($format) === '' || strlen($format) > 40
                    || !is_string($metric) || !in_array($metric, ['card', 'commander', 'color', 'archetype'], true)
                    || !is_string($subjectKey) || $subjectKey === '' || strlen($subjectKey) > 255
                    || !is_int($quantity) || $quantity < 1
                ) {
                    throw new \UnexpectedValueException('Invalid community statistics outbox delta.');
                }
                $this->increment($deltas, $format, $metric, $subjectKey, $quantity);
            }
        }

        return $deltas;
    }

    /**
     * @return array<string,int>
     */
    private function roomStartDeltas(Room $room): array
    {
        $decks = [];
        foreach ($room->players() as $player) {
            if ($player instanceof RoomPlayer && $player->deck() instanceof Deck) {
                $decks[] = $player->deck();
            }
        }

        if ($decks === []) {
            return [];
        }

        $archetypes = $this->primaryArchetypes($decks);
        $deltas = [];
        foreach ($decks as $deck) {
            $format = trim($deck->format());
            if ($format === '') {
                continue;
            }

            $this->increment($deltas, $format, 'color', $this->colorKey($deck), 1);
            $this->increment($deltas, $format, 'archetype', $archetypes[$deck->id()] ?? 'unknown', 1);

            foreach ($deck->cards() as $deckCard) {
                if (!$deckCard instanceof DeckCard) {
                    continue;
                }

                $card = $deckCard->card();
                $key = $this->cardKey($card);
                if ($deckCard->section() === DeckCard::SECTION_COMMANDER) {
                    if (!$card->isBasicLand()) {
                        $this->increment($deltas, $format, 'commander', $key, 1);
                    }
                    continue;
                }
                if ($deckCard->section() === DeckCard::SECTION_MAIN && !$card->isBasicLand()) {
                    $this->increment($deltas, $format, 'card', $key, $deckCard->quantity());
                }
            }
        }

        return $deltas;
    }

    /**
     * @return array{items:list<array<string,mixed>>,total:int,isPreview:bool,message:string}
     */
    public function topCards(string $metric, string $format, ?string $requestedLanguage): array
    {
        if (!in_array($metric, ['card', 'commander'], true)) {
            throw new \InvalidArgumentException('Unsupported card leaderboard metric.');
        }

        return $this->cache->remember(
            sprintf('community.%s-lifetime.%s.%s', $metric, $format, strtolower((string) $requestedLanguage ?: 'en')),
            60,
            fn (): array => $this->cardLeaderboard($metric, $format, $requestedLanguage),
            ['community.leaderboards'],
        );
    }

    /**
     * @return array{items:list<array{key:string,label:string,timesPlayed:int,rank:int,colors?:list<string>}>,total:int}
     */
    public function topDimensions(string $metric, string $format): array
    {
        if (!in_array($metric, ['color', 'archetype'], true)) {
            throw new \InvalidArgumentException('Unsupported dimension leaderboard metric.');
        }

        return $this->cache->remember(
            sprintf('community.%s-lifetime.%s', $metric, $format),
            60,
            fn (): array => $this->dimensionLeaderboard($metric, $format),
            ['community.leaderboards'],
        );
    }

    public function invalidateLeaderboards(): void
    {
        $this->cache->invalidate(['community.leaderboards', 'community.home']);
    }

    /**
     * @param list<Deck> $decks
     * @return array<string,string>
     */
    private function primaryArchetypes(array $decks): array
    {
        $deckIds = array_values(array_unique(array_map(static fn (Deck $deck): string => $deck->id(), $decks)));
        if ($deckIds === []) {
            return [];
        }

        $rows = $this->connection->executeQuery(
            <<<'SQL'
SELECT deck_id, deck_hash, result_json
FROM deck_advanced_analysis_snapshot snapshot
WHERE snapshot.deck_id IN (:deckIds)
SQL,
            ['deckIds' => $deckIds],
            ['deckIds' => ArrayParameterType::STRING],
        )->fetchAllAssociative();
        $archetypes = [];
        $hashes = [];
        foreach ($decks as $deck) {
            $hashes[$deck->id()] = $this->deckHasher->hashDeckCards($deck->cards());
        }
        foreach ($rows as $row) {
            $deckId = (string) ($row['deck_id'] ?? '');
            if ($deckId === '' || ($hashes[$deckId] ?? null) !== (string) ($row['deck_hash'] ?? '')) {
                continue;
            }
            $result = json_decode((string) ($row['result_json'] ?? ''), true);
            $value = is_array($result) ? ($result['summary']['primaryArchetype'] ?? null) : null;
            if (!is_string($value) || preg_match('/^[a-z0-9_]{1,80}$/', $value) !== 1) {
                continue;
            }
            $archetypes[$deckId] = $value;
        }

        return $archetypes;
    }

    /**
     * @param array<string,int> $deltas
     */
    private function increment(array &$deltas, string $format, string $metric, string $subjectKey, int $quantity): void
    {
        $key = implode('|', [$format, $metric, $subjectKey]);
        if ($quantity <= 0) {
            return;
        }

        $deltas[$key] = ($deltas[$key] ?? 0) + $quantity;
    }

    /**
     * @param array<string,int> $deltas
     */
    private function upsert(array $deltas): void
    {
        if ($deltas === []) {
            return;
        }

        $values = [];
        $parameters = [];
        $index = 0;
        foreach ($deltas as $key => $quantity) {
            [$format, $metric, $subjectKey] = explode('|', $key, 3);
            $prefix = 'row'.$index;
            $values[] = sprintf('(:%1$s_format, :%1$s_metric, :%1$s_period, :%1$s_start, :%1$s_subject, :%1$s_usages)', $prefix);
            $parameters[$prefix.'_format'] = $format;
            $parameters[$prefix.'_metric'] = $metric;
            $parameters[$prefix.'_period'] = self::PERIOD_LIFETIME;
            $parameters[$prefix.'_start'] = self::LIFETIME_START;
            $parameters[$prefix.'_subject'] = $subjectKey;
            $parameters[$prefix.'_usages'] = $quantity;
            ++$index;
        }

        $this->connection->executeStatement(
            'INSERT INTO community_counter (format, metric, period, period_start, subject_key, usages) VALUES '.implode(', ', $values).'
             ON CONFLICT (format, metric, period, period_start, subject_key)
             DO UPDATE SET usages = community_counter.usages + EXCLUDED.usages',
            $parameters,
        );
    }

    private function cardKey(Card $card): string
    {
        $oracleId = trim((string) $card->oracleId());

        return $oracleId !== '' ? 'oracle:'.$oracleId : 'print:'.$card->scryfallId();
    }

    private function colorKey(Deck $deck): string
    {
        $colors = [];
        foreach ($deck->cards() as $deckCard) {
            if (!$deckCard instanceof DeckCard || $deckCard->section() !== DeckCard::SECTION_COMMANDER) {
                continue;
            }
            foreach ($deckCard->card()->colorIdentity() as $color) {
                if (in_array($color, ['W', 'U', 'B', 'R', 'G'], true)) {
                    $colors[$color] = true;
                }
            }
        }

        return implode('', array_values(array_filter(['W', 'U', 'B', 'R', 'G'], static fn (string $color): bool => isset($colors[$color])))) ?: 'C';
    }

    /**
     * @return array{items:list<array<string,mixed>>,total:int,isPreview:bool,message:string}
     */
    private function cardLeaderboard(string $metric, string $format, ?string $requestedLanguage): array
    {
        $rows = $this->leaderboardRows($metric, $format);
        $cardsByKey = $this->cardsByKey(array_column($rows, 'subject_key'));
        $payloads = [];
        $counts = [];
        $typeIcons = [];
        foreach ($rows as $row) {
            $key = (string) $row['subject_key'];
            if (!isset($cardsByKey[$key])) {
                continue;
            }
            $payloads[] = $cardsByKey[$key]->toArray();
            $counts[] = (int) $row['usages'];
            $typeIcons[] = $this->cardTypeIcon($cardsByKey[$key]->toArray());
        }
        $localized = $this->localization->localizeCardPayloads($payloads, $requestedLanguage, true);
        $items = [];
        foreach ($localized as $index => $card) {
            $items[] = [
                'id' => (string) ($card['id'] ?? ''),
                'scryfallId' => (string) ($card['scryfallId'] ?? ''),
                'name' => (string) ($card['printedName'] ?? $card['name'] ?? ''),
                'cropImage' => $card['imageUris']['art_crop'] ?? $card['imageUris']['normal'] ?? null,
                'imageUris' => is_array($card['imageUris'] ?? null) ? $card['imageUris'] : [],
                'cardFaces' => is_array($card['cardFaces'] ?? null) ? $card['cardFaces'] : [],
                'colors' => is_array($card['colors'] ?? null) ? $card['colors'] : [],
                'cardType' => $card['typeLine'] ?? null,
                'cardTypeIcon' => $typeIcons[$index],
                'timesPlayed' => $counts[$index],
                'rank' => $index + 1,
            ];
        }

        return ['items' => $items, 'total' => count($items), 'isPreview' => false, 'message' => ''];
    }

    /** @return array{items:list<array{key:string,label:string,timesPlayed:int,rank:int,colors?:list<string>}>,total:int} */
    private function dimensionLeaderboard(string $metric, string $format): array
    {
        $rows = $this->leaderboardRows($metric, $format);
        $items = array_map(static function (array $row, int $index) use ($metric): array {
            $key = (string) $row['subject_key'];
            return [
                'key' => $key,
                'label' => $metric === 'color' ? ($key === 'C' ? 'Colorless' : $key) : ucwords(str_replace('_', ' ', $key)),
                'timesPlayed' => (int) $row['usages'],
                'rank' => $index + 1,
                ...($metric === 'color' && $key !== 'C' ? ['colors' => str_split($key)] : []),
            ];
        }, $rows, array_keys($rows));

        return ['items' => $items, 'total' => count($items)];
    }

    /** @return list<array{subject_key:string,usages:int}> */
    private function leaderboardRows(string $metric, string $format): array
    {
        return $this->connection->executeQuery(
            'SELECT subject_key, usages FROM community_counter
             WHERE format = :format AND metric = :metric AND period = :period AND period_start = :periodStart
             ORDER BY usages DESC, subject_key ASC LIMIT '.self::TOP_LIMIT,
            ['format' => $format, 'metric' => $metric, 'period' => self::PERIOD_LIFETIME, 'periodStart' => self::LIFETIME_START],
        )->fetchAllAssociative();
    }

    /** @param list<string> $keys @return array<string,Card> */
    private function cardsByKey(array $keys): array
    {
        $oracleIds = [];
        $printIds = [];
        foreach ($keys as $key) {
            if (str_starts_with($key, 'oracle:')) {
                $oracleIds[] = substr($key, 7);
            } elseif (str_starts_with($key, 'print:')) {
                $printIds[] = substr($key, 6);
            }
        }
        $cards = [];
        if ($oracleIds !== []) {
            $cards = [...$cards, ...$this->entityManager->getRepository(Card::class)->findBy(['oracleId' => array_values(array_unique($oracleIds))])];
        }
        if ($printIds !== []) {
            $cards = [...$cards, ...$this->entityManager->getRepository(Card::class)->findBy(['scryfallId' => array_values(array_unique($printIds))])];
        }
        $result = [];
        foreach ($cards as $card) {
            if ($card instanceof Card) {
                $result[$this->cardKey($card)] ??= $card;
            }
        }

        return $result;
    }

    /** @param array<string,mixed> $card */
    private function cardTypeIcon(array $card): ?string
    {
        $typeLine = strtolower((string) ($card['typeLine'] ?? ''));
        foreach (['battle', 'creature', 'artifact', 'enchantment', 'instant', 'land', 'planeswalker', 'sorcery'] as $icon) {
            if (str_contains($typeLine, $icon)) {
                return $icon;
            }
        }

        return $typeLine === '' ? null : 'multiple';
    }
}
