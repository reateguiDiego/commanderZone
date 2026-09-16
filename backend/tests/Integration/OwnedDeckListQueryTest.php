<?php

namespace App\Tests\Integration;

use App\Application\Deck\OwnedDeckListQuery;
use App\Application\Card\CardLocalizationService;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\User\User;
use App\UI\Http\DecksController;
use Symfony\Component\HttpFoundation\Request;
use App\Infrastructure\Observability\RequestPerformanceContext;
use App\Tests\Integration\Support\OwnedDeckListFixture;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

final class OwnedDeckListQueryTest extends KernelTestCase
{
    public function testPageWorkIsBoundedWithOneHundredThousandDeckCards(): void
    {
        self::bootKernel();
        $em = static::getContainer()->get(EntityManagerInterface::class);
        $query = static::getContainer()->get(OwnedDeckListQuery::class);
        $metrics = static::getContainer()->get(RequestPerformanceContext::class);
        try {
            OwnedDeckListFixture::create($em);
            OwnedDeckListFixture::indexes($em);
            foreach ([1, 10, 100] as $limit) {
                $em->clear();
                $metrics->reset();
                $page = $query->page(OwnedDeckListFixture::OWNER, limit: $limit);
                self::assertCount($limit, $page['data']);
                self::assertSame(3, $metrics->metrics()['query_count']);
                self::assertLessThanOrEqual(2 * $limit + 1, $metrics->metrics()['rows']);
                self::assertArrayNotHasKey(Deck::class, $em->getUnitOfWork()->getIdentityMap());
                self::assertArrayNotHasKey(DeckCard::class, $em->getUnitOfWork()->getIdentityMap());
                foreach ($page['data'] as $deck) {
                    self::assertArrayNotHasKey('cards', $deck);
                    self::assertNull($deck['bracket']);
                    self::assertCount($deck['folderId'] === null ? 0 : 1, $deck['commanders']);
                }
            }
            $expected = $em->getConnection()->fetchFirstColumn('SELECT id FROM deck ORDER BY updated_at DESC, id DESC');
            $seen = [];
            $cursor = null;
            do {
                $page = $query->page(OwnedDeckListFixture::OWNER, limit: 100, cursor: $cursor);
                array_push($seen, ...array_column($page['data'], 'id'));
                $cursor = $page['nextCursor'];
            } while ($cursor !== null);
            self::assertSame($expected, $seen);
            self::assertSame(['data' => [], 'nextCursor' => null], $query->page(OwnedDeckListFixture::OWNER, 'empty', true));
            self::assertSame(['data' => [], 'nextCursor' => null], $query->page('another-owner'));
            foreach ([null, OwnedDeckListFixture::FOLDER] as $folder) {
                $page = $query->page(OwnedDeckListFixture::OWNER, $folder, true);
                self::assertCount(50, $page['data']);
                foreach ($page['data'] as $deck) self::assertSame($folder, $deck['folderId']);
                $second = $query->page(OwnedDeckListFixture::OWNER, $folder, true, cursor: $page['nextCursor']);
                self::assertSame([], array_intersect(array_column($page['data'], 'id'), array_column($second['data'], 'id')));
            }
            // Exercise the controller too: per-deck localization must not
            // reintroduce N+1 queries, even with many different commanders.
            $user = new User('list-load@example.test', 'Load user');
            (new \ReflectionProperty(User::class, 'id'))->setValue($user, OwnedDeckListFixture::OWNER);
            foreach ([10, 100] as $limit) {
                $metrics->reset();
                $response = static::getContainer()->get(DecksController::class)->list(
                    Request::create('/decks', parameters: ['limit' => $limit]), $user, $em,
                    static::getContainer()->get(CardLocalizationService::class), $query);
                self::assertSame(200, $response->getStatusCode());
                self::assertLessThanOrEqual(21, $metrics->metrics()['query_count']);
                self::assertSame(0, $em->getUnitOfWork()->size());
            }
            $db = $em->getConnection();
            $db->executeStatement("INSERT INTO deck_analysis_snapshot
                (id, deck_id, deck_hash, options_hash, analyzer_version, semantic_data_version, mana_data_version, combo_data_version, rules_version, result_json, calculated_at, created_at, updated_at)
                SELECT id, id, 'test', 'test', 'test', 'test', 'test', 'test', 'test', '{\"bracket\": {\"bracket\": 3}}'::jsonb,
                    updated_at, updated_at, updated_at FROM deck");
            $metrics->reset();
            $page = $query->page(OwnedDeckListFixture::OWNER, limit: 100);
            self::assertSame(3, $metrics->metrics()['query_count']);
            self::assertLessThanOrEqual(301, $metrics->metrics()['rows'], 'Bracket lookup must return page IDs only.');
            foreach ($page['data'] as $deck) self::assertSame(['bracket' => 3, 'label' => 'Upgraded'], $deck['bracket']);
            $db->executeStatement("UPDATE deck_analysis_snapshot SET updated_at = updated_at - interval '1 second'");
            self::assertNull($query->page(OwnedDeckListFixture::OWNER, limit: 1)['data'][0]['bracket']);
        } finally {
            OwnedDeckListFixture::drop($em);
        }
    }
}
