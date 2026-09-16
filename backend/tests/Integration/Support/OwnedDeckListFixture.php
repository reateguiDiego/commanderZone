<?php

namespace App\Tests\Integration\Support;

use App\Domain\Card\Card;
use Doctrine\ORM\EntityManagerInterface;

/** Session-local account with many decks; shared by regression tests and benchmark. */
final class OwnedDeckListFixture
{
    public const OWNER = '00000000-0000-4000-8000-000000000001';
    public const FOLDER = '00000000-0000-4000-8000-000000000002';

    public static function create(EntityManagerInterface $em, int $decks = 1000): void
    {
        $db = $em->getConnection();
        foreach (['deck', 'deck_card', 'card', 'deck_analysis_snapshot'] as $table) {
            $db->executeStatement('CREATE TEMP TABLE '.$table.' (LIKE public.'.$table.' INCLUDING DEFAULTS)');
        }
        $db->executeStatement('CREATE UNIQUE INDEX ON card (id)');
        $db->executeStatement('CREATE INDEX ON deck_card (deck_id, section)');
        $db->executeStatement('CREATE UNIQUE INDEX ON deck (id)');
        $db->executeStatement('CREATE INDEX ON deck_analysis_snapshot (deck_id)');
        for ($i = 0; $i < 100; ++$i) {
            $card = new Card(sprintf('00000000-0000-4000-8000-%012d', $i + 100));
            $card->updateFromScryfall(['name' => 'Fixture card '.$i, 'type_line' => 'Legendary Creature', 'lang' => 'en', 'legalities' => ['commander' => 'legal']]);
            $em->persist($card);
        }
        $em->flush();
        $db->executeStatement("INSERT INTO deck (id, owner_id, creator_user_id, name, format, visibility, is_valid, background_name, sleeves_name, likes, copies, folder_id, created_at, updated_at)
            SELECT md5(('deck-' || n)::text)::uuid::text, :owner, :owner, 'Deck ' || n, 'commander', 'private', false, 'free_0', 'facedown_card', 0, 0,
                CASE WHEN n % 2 = 0 THEN :folder ELSE NULL END, '2026-01-01'::timestamp, '2026-01-01'::timestamp + (n / 3) * interval '1 second'
            FROM generate_series(1, :count) n", ['owner' => self::OWNER, 'folder' => self::FOLDER, 'count' => $decks]);
        $db->executeStatement("INSERT INTO deck_card (id, deck_id, card_id, quantity, section, updated_at)
            SELECT md5(d.id || c.id)::uuid::text, d.id, c.id, 1,
                CASE WHEN c.scryfall_id = '00000000-0000-4000-8000-' || lpad(((substring(d.name from 6)::int % 100) + 100)::text, 12, '0')
                    AND d.folder_id IS NOT NULL THEN 'commander' ELSE 'main' END,
                d.updated_at FROM deck d CROSS JOIN card c");
        foreach (['deck', 'deck_card', 'card', 'deck_analysis_snapshot'] as $table) $db->executeStatement('ANALYZE '.$table);
        $em->clear();
    }

    public static function indexes(EntityManagerInterface $em): void
    {
        $em->getConnection()->executeStatement('CREATE INDEX idx_deck_owner_folder_updated_id ON deck (owner_id, folder_id, updated_at, id)');
        $em->getConnection()->executeStatement('CREATE INDEX idx_deck_owner_updated_id ON deck (owner_id, updated_at, id)');
        $em->getConnection()->executeStatement('ANALYZE deck');
    }

    public static function drop(EntityManagerInterface $em): void
    {
        $em->clear();
        $em->getConnection()->executeStatement('DROP TABLE IF EXISTS pg_temp.deck_card, pg_temp.deck, pg_temp.card, pg_temp.deck_analysis_snapshot');
    }
}
