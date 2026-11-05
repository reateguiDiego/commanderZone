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
    public function testFallbackPreservesQualityEditionAndEnglishPriority(): void
    {
        $this->seedChoice('source', 'ja', 'source');
        $this->seedChoice('bad', 'es', 'aaa', 'placeholder');
        $this->seedChoice('good', 'es', 'bbb');
        $this->seedChoice('later', 'es', 'ccc');
        $this->seedChoice('english', 'en', 'ddd');
        $resolver = new CardLocalizedPayloadResolver($this->entityManager->getConnection());
        $result = $resolver->buildLocalizedLookupForScryfallIds(['source'], ['es', 'en', 'fr']);
        self::assertSame('good', $result['es']['source']['scryfallId']);
        self::assertSame('english', $result['en']['source']['scryfallId']);
        self::assertSame('english', $result['fr']['source']['scryfallId']);
        self::assertSame('https://cards.scryfall.io/normal/front/good.jpg', $result['es']['source']['imageUris']['normal']);
    }

    public function testUnavailableExactPrintingStillFallsBackToEnglishRatherThanAnotherEdition(): void
    {
        $this->seedChoice('source', 'es', 'source', 'placeholder');
        $this->seedChoice('other-edition', 'es', 'aaa');
        $this->seedChoice('english', 'en', 'source');
        $result = (new CardLocalizedPayloadResolver($this->entityManager->getConnection()))
            ->buildLocalizedLookupForScryfallIds(['source'], ['es']);
        self::assertSame('english', $result['es']['source']['scryfallId']);
    }

    public function testScopedCacheReusesEnglishSelectionAndClearsAfterException(): void
    {
        $this->seedChoice('source', 'ja', 'source');
        $this->seedChoice('english', 'en', 'bbb');
        $resolver = new CardLocalizedPayloadResolver($this->entityManager->getConnection());
        $performance = static::getContainer()->get(RequestPerformanceContext::class);
        try {
            $resolver->withCandidateCache(function () use ($resolver, $performance): void {
                $resolver->buildLocalizedLookupForScryfallIds(['source'], ['es']);
                $performance->reset();
                $result = $resolver->withCandidateCache(fn () => $resolver->buildLocalizedLookupForScryfallIds(['source'], ['en']));
                self::assertSame('english', $result['en']['source']['scryfallId']);
                // Only fetch the source and selected payload; no candidate searches.
                self::assertSame(2, $performance->metrics()['query_count']);
                throw new \RuntimeException('finish scope');
            });
            self::fail('Expected exception');
        } catch (\RuntimeException $exception) {
            self::assertSame('finish scope', $exception->getMessage());
        }
        $this->seedChoice('new-english', 'en', 'aaa');
        $result = $resolver->buildLocalizedLookupForScryfallIds(['source'], ['en']);
        self::assertSame('new-english', $result['en']['source']['scryfallId']);
    }

    public function testScopedCacheRemembersMissingPairsButDoesNotLeakToNextOperation(): void
    {
        $this->seedChoice('source', 'ja', 'source');
        $resolver = new CardLocalizedPayloadResolver($this->entityManager->getConnection());
        $performance = static::getContainer()->get(RequestPerformanceContext::class);
        $resolver->withCandidateCache(function () use ($resolver, $performance): void {
            $resolver->buildLocalizedLookupForScryfallIds(['source'], ['es']);
            $performance->reset();
            $result = $resolver->buildLocalizedLookupForScryfallIds(['source'], ['es']);
            self::assertSame('source', $result['es']['source']['scryfallId']);
            self::assertSame(1, $performance->metrics()['query_count']);
        });
        $this->seedChoice('new-spanish', 'es', 'aaa');
        $result = $resolver->buildLocalizedLookupForScryfallIds(['source'], ['es']);
        self::assertSame('new-spanish', $result['es']['source']['scryfallId']);
    }

    public function testLegacyExactCandidateKeepsPriorityOverPrintTableNameFallback(): void
    {
        $this->seedChoice('source', 'ja', 'source');
        $this->seedChoice('legacy', 'es', 'source');
        $this->entityManager->getConnection()->executeStatement('DELETE FROM card_print WHERE scryfall_id = ?', ['legacy']);
        $this->seedChoice('modern-fallback', 'es', 'aaa');
        $result = (new CardLocalizedPayloadResolver($this->entityManager->getConnection()))
            ->buildLocalizedLookupForScryfallIds(['source'], ['es']);
        self::assertSame('legacy', $result['es']['source']['scryfallId']);
    }

    private function seedChoice(string $id, string $language, string $set, string $status = 'highres'): void
    {
        $this->seedCard($id, 'Repeated Printing', [
            'lang' => $language, 'set' => $set, 'collector_number' => '1', 'image_status' => $status,
        ]);
    }

}
