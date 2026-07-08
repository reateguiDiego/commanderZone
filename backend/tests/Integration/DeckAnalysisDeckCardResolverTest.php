<?php

namespace App\Tests\Integration;

use App\Application\Card\CardOracleProfileRebuilder;
use App\Application\Deck\CardAnalysisProfileRebuilder;
use App\Application\Deck\DeckAnalysisDeckCardResolver;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\User\User;

final class DeckAnalysisDeckCardResolverTest extends ApiTestCase
{
    public function testResolverSkipsDeckCardsWithoutOracleIdWithoutFailing(): void
    {
        $resolvedCard = $this->seedCard('89000000-0000-0000-0000-000000000001', 'Resolved Card', [
            'oracle_id' => '89000000-0000-0000-0000-000000000101',
        ]);
        $unresolvedCard = $this->seedCard('89000000-0000-0000-0000-000000000002', 'Unresolved Card', [
            'oracle_id' => null,
        ]);
        (new CardOracleProfileRebuilder($this->entityManager->getConnection()))->rebuild();
        (new CardAnalysisProfileRebuilder($this->entityManager->getConnection()))->rebuild();

        $user = new User('deck-analysis-resolver@example.test', 'DeckResolver');
        $user->setPassword('hash');
        $deck = new Deck($user, 'Resolver Deck');
        $deck->addOrIncrementCard($resolvedCard, 2, DeckCard::SECTION_MAIN);
        $deck->addOrIncrementCard($unresolvedCard, 1, DeckCard::SECTION_MAIN);
        $this->entityManager->persist($user);
        $this->entityManager->persist($deck);
        $this->entityManager->flush();

        $result = (new DeckAnalysisDeckCardResolver($this->entityManager->getConnection()))->resolve($deck->id());

        self::assertCount(1, $result['resolved']);
        self::assertSame('89000000-0000-0000-0000-000000000101', $result['resolved'][0]['oracle_id']);
        self::assertSame(2, $result['resolved'][0]['quantity']);
        self::assertCount(1, $result['unmatched']);
        self::assertSame('missing_oracle_id', $result['unmatched'][0]['reason']);
        self::assertSame(1, $result['unmatched'][0]['quantity']);
    }
}
