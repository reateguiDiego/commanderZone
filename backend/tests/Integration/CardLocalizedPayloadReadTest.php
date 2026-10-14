<?php

namespace App\Tests\Integration;

use App\Application\Card\CardLocalizedPayloadResolver;
use App\Infrastructure\Observability\RequestPerformanceContext;

final class CardLocalizedPayloadReadTest extends ApiTestCase
{
    public function testMixedLanguageFallbackLoadsOnlySelectedPayloadPairs(): void
    {
        foreach (['a', 'b'] as $id) {
            $this->seedCard('pair-'.$id, 'Card '.$id, ['lang' => 'en', 'set' => 'pairs', 'collector_number' => $id]);
        }
        $connection = $this->entityManager->getConnection();
        foreach (['a', 'b'] as $id) {
            $connection->executeStatement(
                "INSERT INTO card_print_locale (print_scryfall_id, lang, name, printed_name, image_uris, card_faces, image_status, updated_at) VALUES (?, 'es', ?, ?, '{}'::jsonb, '[]'::jsonb, ?, NOW())",
                ['pair-'.$id, 'Card '.$id, 'Carta '.$id, $id === 'b' ? 'placeholder' : 'highres'],
            );
        }
        $resolver = new CardLocalizedPayloadResolver($connection);
        // Warm only schema discovery, not any card data.
        $resolver->buildLocalizedLookupForScryfallIds(['absent'], ['es']);
        $performance = static::getContainer()->get(RequestPerformanceContext::class);
        $performance->reset();
        $result = $resolver->buildLocalizedLookupForScryfallIds(['pair-a', 'pair-b'], ['es']);
        self::assertSame('Carta a', $result['es']['pair-a']['name']);
        self::assertSame('es', $result['es']['pair-a']['lang']);
        self::assertSame('Card b', $result['es']['pair-b']['name']);
        self::assertSame('en', $result['es']['pair-b']['lang']);
        self::assertSame('pair-a', $result['es']['pair-a']['scryfallId']);
        self::assertSame('pair-b', $result['es']['pair-b']['scryfallId']);
        // Two sources + four identity candidates + only two selected payloads.
        self::assertSame(8, $performance->metrics()['rows']);
        self::assertSame(3, $performance->metrics()['query_count']);
    }
}
