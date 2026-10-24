<?php

namespace App\Tests\Integration;

use App\Application\Card\CardSearchEntryRebuilder;

final class CardRulesSearchTest extends ApiTestCase
{
    public function testRulesCandidatesPreserveLanguagesFiltersAndPagination(): void
    {
        $this->seedCard('rules-a', 'A Rules', ['lang' => 'en', 'oracle_text' => 'Landfall. Draw a card.', 'rarity' => 'rare']);
        $this->seedCard('rules-b', 'B Rules', ['lang' => 'en', 'oracle_text' => 'Landfall.', 'rarity' => 'common']);
        $this->seedCard('rules-c', 'C Rules', ['lang' => 'en', 'oracle_text' => 'Pirates.', 'card_faces' => [['oracle_text' => 'Aterrizaje. Rat.']], 'rarity' => 'rare']);
        $this->seedCard('rules-d', 'D Rules', ['lang' => 'en', 'oracle_text' => 'Pirates.', 'rarity' => 'rare']);
        foreach ([['rules-a', 'es', 'Áterrizaje.'], ['rules-a', 'fr', 'Áterrizaje.'], ['rules-b', 'es', 'Roba una carta.']] as [$id, $lang, $text]) {
            $this->entityManager->getConnection()->executeStatement(
                "INSERT INTO card_print_locale (print_scryfall_id, lang, name, oracle_text, image_uris, card_faces, updated_at) VALUES (?, ?, ?, ?, '{}', '[]', NOW())",
                [$id, $lang, $id, $text],
            );
        }

        // Exercise both the fallback and the production catalog path.
        foreach ([false, true] as $catalog) {
            if ($catalog) {
                static::getContainer()->get(CardSearchEntryRebuilder::class)->rebuild();
            }
            foreach ([
                ['oracleTextA=aterrizaje', ['rules-a', 'rules-c']],
                ['oracleTextA=landfall&oracleTextB=aterrizaje&oracleTextMode=and', ['rules-a']],
                ['oracleTextA=landfall&oracleTextB=roba&oracleTextMode=and', ['rules-b']],
                ['oracleTextA=landfall&oracleTextB=aterrizaje&oracleTextMode=or', ['rules-a', 'rules-b', 'rules-c']],
                ['oracleTextA=rat&oracleTextExact=true', ['rules-c']],
                ['oracleTextA=rat', ['rules-c', 'rules-d']],
                ['oracleTextA=landfall&rarities=common', ['rules-b']],
                ['oracleTextA=nonexistent', []],
            ] as [$filters, $expected]) {
                $this->jsonRequest('GET', '/cards/search?lang=es&sort=name_asc&limit=20&'.$filters);
                self::assertResponseIsSuccessful();
                $payload = $this->jsonResponse();
                self::assertSame($expected, array_column($payload['data'], 'scryfallId'), $filters.' catalog='.(int) $catalog);
                self::assertSame(count($expected), $payload['total']);
            }
            foreach ([1 => 'rules-a', 2 => 'rules-b', 3 => 'rules-c'] as $page => $id) {
                $this->jsonRequest('GET', '/cards/search?lang=es&sort=name_asc&limit=1&page='.$page.'&oracleTextA=landfall&oracleTextB=aterrizaje&oracleTextMode=or');
                self::assertResponseIsSuccessful();
                $payload = $this->jsonResponse();
                self::assertSame([$id], array_column($payload['data'], 'scryfallId'));
                self::assertSame(3, $payload['total']);
                self::assertSame($page < 3, $payload['hasMore']);
            }
        }
    }
}
