<?php

namespace App\Application\Deck;

use App\Domain\Card\Card;
use App\Domain\Deck\DeckCard;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;

/** Reads deck tiles only. Never initializes Deck or its cards collection. */
final class OwnedDeckListQuery
{
    public function __construct(private readonly Connection $connection, private readonly EntityManagerInterface $entityManager, private readonly DeckBracketLabelProvider $brackets)
    {
    }

    public function page(string $ownerId, ?string $folderId = null, bool $filterFolder = false, int $limit = 50, ?string $cursor = null): array
    {
        if ($limit < 1 || $limit > 100) {
            throw new \InvalidArgumentException('Limit must be between 1 and 100.');
        }
        $params = ['owner' => $ownerId];
        $where = 'd.owner_id = :owner';
        if ($filterFolder) {
            $where .= $folderId === null ? ' AND d.folder_id IS NULL' : ' AND d.folder_id = :folder';
            if ($folderId !== null) $params['folder'] = $folderId;
        }
        if ($cursor !== null) {
            $position = $this->decodeCursor($cursor);
            if ($position['owner'] !== $ownerId || $position['folder'] !== ($filterFolder ? $folderId : '*')) {
                throw new \InvalidArgumentException('Cursor does not match this deck list.');
            }
            $where .= ' AND (d.updated_at, d.id) < (:updated, :id)';
            $params += ['updated' => $position['updated'], 'id' => $position['id']];
        }
        $rows = $this->connection->fetchAllAssociative('SELECT d.id, d.name, d.format, d.is_valid, d.visibility, d.slug, d.public_slug,
            d.creator_user_id, d.likes, d.copies, d.background_name, d.sleeves_name, d.folder_id, d.updated_at
            FROM deck d WHERE '.$where.' ORDER BY d.updated_at DESC, d.id DESC LIMIT '.($limit + 1), $params);
        $hasMore = count($rows) > $limit;
        $rows = array_slice($rows, 0, $limit);
        $ids = array_column($rows, 'id');
        $commanders = [];
        if ($ids !== []) {
            // Scalar hydration preserves shared commanders across decks without
            // loading entities, deck collections or unrelated card metadata.
            $fields = ['id', 'scryfallId', 'oracleId', 'name', 'manaCost', 'typeLine', 'oracleText',
                'power', 'toughness', 'loyalty', 'colors', 'colorIdentity', 'legalities', 'imageUris',
                'cardFaces', 'hasRulings', 'allParts', 'manaValue', 'isGameChanger', 'producedMana',
                'prices', 'layout', 'commanderLegal', 'setName', 'rarity', 'collectorNumber', 'lang', 'printedName', 'flavorName'];
            $select = implode(', ', array_map(static fn (string $field): string => 'c.'.$field.' AS '.$field, $fields));
            $entries = $this->entityManager->createQuery('SELECT '.$select.', c.setCode AS set, IDENTITY(dc.deck) AS deckId FROM '.Card::class.' c
                JOIN '.DeckCard::class.' dc WITH dc.card = c WHERE dc.deck IN (:ids) AND dc.section = :section ORDER BY dc.id ASC')
                ->setParameter('ids', $ids)->setParameter('section', DeckCard::SECTION_COMMANDER)->getScalarResult();
            foreach ($entries as $entry) {
                $deckId = $entry['deckId'];
                unset($entry['deckId']);
                foreach (['colors', 'colorIdentity', 'legalities', 'imageUris', 'cardFaces', 'allParts', 'producedMana', 'prices'] as $field) {
                    if (is_string($entry[$field])) $entry[$field] = json_decode($entry[$field], true, 512, JSON_THROW_ON_ERROR);
                }
                foreach (['hasRulings', 'isGameChanger', 'commanderLegal'] as $field) $entry[$field] = (bool) $entry[$field];
                $entry['manaValue'] = $entry['manaValue'] === null ? null : (float) $entry['manaValue'];
                $entry['name'] = trim((string) $entry['printedName']) !== '' ? $entry['printedName'] : $entry['name'];
                $entry['cardFaces'] = array_map(Card::normalizeCardFace(...), $entry['cardFaces']);
                $commanders[$deckId][] = $entry;
            }
        }
        // Missing/stale snapshots stay null: list reads never calculate full decks.
        $labels = $this->brackets->labelsByDeckIds($ids);
        $data = array_map(static fn (array $row): array => [
            'id' => $row['id'], 'name' => $row['name'], 'format' => $row['format'], 'valid' => (bool) $row['is_valid'],
            'visibility' => $row['visibility'], 'slug' => $row['slug'], 'publicSlug' => $row['public_slug'],
            'canonicalPath' => $row['public_slug'] === null ? null : '/community/decks/'.$row['public_slug'].'/',
            'creatorUserId' => $row['creator_user_id'], 'likes' => (int) $row['likes'], 'copies' => (int) $row['copies'],
            'backgroundName' => $row['background_name'], 'sleevesName' => $row['sleeves_name'], 'folderId' => $row['folder_id'],
            'commanders' => $commanders[$row['id']] ?? [], 'bracket' => $labels[$row['id']] ?? null,
        ], $rows);
        $last = $rows === [] ? null : $rows[array_key_last($rows)];
        $nextCursor = $hasMore ? rtrim(strtr(base64_encode(json_encode([
            'owner' => $ownerId, 'folder' => $filterFolder ? $folderId : '*', 'updated' => $last['updated_at'], 'id' => $last['id'],
        ], JSON_THROW_ON_ERROR)), '+/', '-_'), '=') : null;

        return ['data' => $data, 'nextCursor' => $nextCursor];
    }

    private function decodeCursor(string $cursor): array
    {
        $decoded = strlen($cursor) <= 1024 ? base64_decode(strtr($cursor, '-_', '+/'), true) : false;
        $value = $decoded === false ? null : json_decode($decoded, true);
        if (!is_array($value) || !is_string($value['owner'] ?? null) || !array_key_exists('folder', $value)
            // Existing load fixtures also use UUID-shaped MD5 identifiers.
            || !is_string($value['id'] ?? null) || !preg_match('/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iD', $value['id'])
            || !is_string($value['updated'] ?? null)
            || !preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/D', $value['updated'])
            || (int) substr($value['updated'], 0, 4) === 0) {
            throw new \InvalidArgumentException('Invalid deck list cursor.');
        }
        $date = \DateTimeImmutable::createFromFormat(str_contains($value['updated'], '.') ? '!Y-m-d H:i:s.u' : '!Y-m-d H:i:s', $value['updated']);
        if ($date === false || \DateTimeImmutable::getLastErrors() !== false) throw new \InvalidArgumentException('Invalid deck list cursor.');

        return $value;
    }
}
