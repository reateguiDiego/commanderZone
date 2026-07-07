<?php

namespace App\Tests\Integration;

use App\Domain\Card\Card;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\User\User;

final class DeckAdvancedAnalysisApiTest extends ApiTestCase
{
    public function testEndpointReturnsCompletedAnalysisAndDoesNotChangeSimpleAnalysis(): void
    {
        [$token, $deck] = $this->advancedDeckFixture('endpoint-completed');

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame($deck->id(), $response['deckId']);
        self::assertSame('advanced-v1.5.0', $response['analyzerVersion']);
        self::assertSame('completed', $response['summary']['status']);
        self::assertSame(2, $response['metrics']['cards']['totalCards']);
        self::assertSame(1, $response['metrics']['cards']['uniqueCards']);
        self::assertSame(2, $response['metrics']['cards']['resolvedCards']);
        self::assertSame(0, $response['metrics']['cards']['unmatchedCards']);
        self::assertArrayHasKey('roles', $response['metrics']);
        self::assertArrayHasKey('quality', $response['metrics']);
        self::assertSame(0, $response['combos']['completeCount']);
        self::assertSame([], $response['topComboCompleters']);
        self::assertArrayHasKey('primary', $response['archetypes']);
        self::assertArrayHasKey('band', $response['power']);
        self::assertSame('monte_carlo', $response['consistency']['method']);
        self::assertSame('opening_hand_and_card_access', $response['consistency']['scope']);
        self::assertStringContainsString('not match win rate', $response['consistency']['disclaimer']);
        self::assertArrayHasKey('archetypeConfidence', $response['summary']);
        self::assertArrayHasKey('powerConfidence', $response['summary']);
        self::assertArrayHasKey('ramp', $response['health']);
        self::assertArrayHasKey('message', $response['health']['ramp']);
        self::assertArrayHasKey('evidence', $response['health']['ramp']);
        self::assertArrayHasKey('suggestedActionType', $response['issues'][0]);
        self::assertArrayHasKey('targetRoles', $response['recommendations'][0]);
        self::assertFalse($response['snapshot']['hit']);
        self::assertSame('missing', $response['snapshot']['reason']);
        self::assertSame(100000, $response['snapshot']['monteCarloRuns']);

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis', token: $token);
        self::assertResponseIsSuccessful();
        $simple = $this->jsonResponse();
        self::assertArrayHasKey('manaCurve', $simple);
        self::assertArrayNotHasKey('snapshot', $simple);
    }

    public function testEndpointRespectsDeckOwnership(): void
    {
        [$token, $deck] = $this->advancedDeckFixture('endpoint-permissions');
        $otherToken = $this->registerAndLogin('advanced-other@example.test', 'Advanced Other');

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $otherToken);

        self::assertResponseStatusCodeSame(404);
        self::assertSame('0', (string) $this->connection()->fetchOne('SELECT COUNT(*) FROM deck_advanced_analysis_snapshot WHERE deck_id = :deckId', ['deckId' => $deck->id()]));

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);
        self::assertResponseIsSuccessful();
    }

    public function testEndpointUsesSnapshotAndInvalidatesWhenDeckChanges(): void
    {
        [$token, $deck] = $this->advancedDeckFixture('endpoint-snapshot');
        $extraCard = $this->seedCard('99000000-0000-0000-0000-000000000901', 'Advanced Extra', [
            'oracle_id' => '99000000-0000-0000-0001-000000000901',
        ]);
        $this->insertAnalysisProfile($extraCard->oracleId(), 'Advanced Extra');

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);
        self::assertResponseIsSuccessful();
        self::assertSame('missing', $this->jsonResponse()['snapshot']['reason']);

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);
        self::assertResponseIsSuccessful();
        $second = $this->jsonResponse();
        self::assertTrue($second['snapshot']['hit']);
        self::assertSame('fresh', $second['snapshot']['reason']);

        $deck->addOrIncrementCard($extraCard, 1, DeckCard::SECTION_MAIN);
        $this->entityManager->flush();

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);
        self::assertResponseIsSuccessful();
        $third = $this->jsonResponse();
        self::assertFalse($third['snapshot']['hit']);
        self::assertSame('deck_hash_changed', $third['snapshot']['reason']);
        self::assertSame(3, $third['metrics']['cards']['resolvedCards']);
    }

    public function testEndpointReturnsNotFoundForMissingDeck(): void
    {
        $token = $this->registerAndLogin('advanced-missing-deck@example.test', 'Advanced Missing');

        $this->jsonRequest('GET', '/decks/00000000-0000-0000-0000-000000000000/analysis/advanced', token: $token);

        self::assertResponseStatusCodeSame(404);
    }

    public function testEndpointReturnsUnmatchedCardsWithoutFailing(): void
    {
        $token = $this->registerAndLogin('advanced-unmatched@example.test', 'Advanced Unmatched');
        $user = $this->entityManager->getRepository(User::class)->find($this->currentUserId($token));
        self::assertInstanceOf(User::class, $user);
        $card = $this->seedCard('99000000-0000-0000-0000-000000000902', 'Advanced Missing Oracle', [
            'oracle_id' => null,
        ]);
        $deck = new Deck($user, 'Advanced Unmatched');
        $deck->addOrIncrementCard($card, 1, DeckCard::SECTION_MAIN);
        $this->entityManager->persist($deck);
        $this->entityManager->flush();

        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame(1, $response['metrics']['cards']['unmatchedCards']);
        self::assertSame('missing_oracle_id', $response['unmatchedCards'][0]['reason']);
    }

    /**
     * @return array{0:string,1:Deck}
     */
    private function advancedDeckFixture(string $suffix): array
    {
        $token = $this->registerAndLogin('advanced-'.$suffix.'@example.test', substr('Adv'.$suffix, 0, 20));
        $user = $this->entityManager->getRepository(User::class)->find($this->currentUserId($token));
        self::assertInstanceOf(User::class, $user);
        $card = $this->seedCard('99000000-0000-0000-0000-'.substr(md5($suffix), 0, 12), 'Advanced Card '.$suffix, [
            'oracle_id' => '99000000-0000-0000-0001-'.substr(md5($suffix), 0, 12),
        ]);
        $this->insertAnalysisProfile($card->oracleId(), 'Advanced Card '.$suffix);
        $deck = new Deck($user, 'Advanced '.$suffix);
        $deck->addOrIncrementCard($card, 2, DeckCard::SECTION_MAIN);
        $this->entityManager->persist($deck);
        $this->entityManager->flush();

        return [$token, $deck];
    }

    private function connection(): \Doctrine\DBAL\Connection
    {
        return $this->entityManager->getConnection();
    }

    private function insertAnalysisProfile(?string $oracleId, string $name): void
    {
        self::assertNotNull($oracleId);
        $this->connection()->executeStatement(
            <<<'SQL'
INSERT INTO card_analysis_profile (
    oracle_id,
    name,
    normalized_name,
    mana_value,
    type_line,
    colors,
    color_identity,
    produced_mana,
    keywords,
    commander_legal,
    roles,
    subroles,
    role_scores,
    condition_keys,
    archetype_weights,
    power_flags,
    analysis_hash,
    updated_at
) VALUES (
    :oracle_id,
    :name,
    :normalized_name,
    1,
    'Artifact',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    true,
    '[]'::jsonb,
    '[]'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    :analysis_hash,
    NOW()
)
SQL,
            [
                'oracle_id' => $oracleId,
                'name' => $name,
                'normalized_name' => mb_strtolower($name),
                'analysis_hash' => hash('sha256', $oracleId),
            ],
        );
    }
}
