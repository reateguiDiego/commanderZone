<?php

namespace App\Tests\Integration;

use App\Domain\Card\Card;
use Doctrine\DBAL\Connection;

final class CommunityDeckAdvancedAnalysisApiTest extends ApiTestCase
{
    public function testPublicDeckBySlugReturnsAdvancedAnalysisAndCreatesSnapshot(): void
    {
        [$token, $deckId, $publicSlug] = $this->publicAdvancedDeckFixture('community-create');

        $this->jsonRequest('GET', '/community/decks/'.$publicSlug.'/analysis');

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        $this->assertAdvancedAnalysisContract($response);
        self::assertSame($deckId, $response['deckId']);
        self::assertFalse($response['snapshot']['hit']);
        self::assertSame('missing', $response['snapshot']['reason']);
        self::assertSame('1', (string) $this->connection()->fetchOne(
            'SELECT COUNT(*) FROM deck_advanced_analysis_snapshot WHERE deck_id = :deckId',
            ['deckId' => $deckId],
        ));

        $this->jsonRequest('GET', '/decks/'.$deckId.'/analysis/advanced', token: $token);
        self::assertResponseIsSuccessful();
    }

    public function testSnapshotIsReusedFromOwnedEndpointToCommunityEndpoint(): void
    {
        [$token, $deckId, $publicSlug] = $this->publicAdvancedDeckFixture('id-to-community');

        $this->jsonRequest('GET', '/decks/'.$deckId.'/analysis/advanced', token: $token);
        self::assertResponseIsSuccessful();
        self::assertFalse($this->jsonResponse()['snapshot']['hit']);
        $snapshotId = $this->snapshotId($deckId);

        $this->jsonRequest('GET', '/community/decks/'.$publicSlug.'/analysis');

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertTrue($response['snapshot']['hit']);
        self::assertSame('fresh', $response['snapshot']['reason']);
        self::assertSame($snapshotId, $this->snapshotId($deckId));
        self::assertSame('1', (string) $this->connection()->fetchOne(
            'SELECT COUNT(*) FROM deck_advanced_analysis_snapshot WHERE deck_id = :deckId',
            ['deckId' => $deckId],
        ));
    }

    public function testSnapshotIsReusedFromCommunityEndpointToOwnedEndpoint(): void
    {
        [$token, $deckId, $publicSlug] = $this->publicAdvancedDeckFixture('community-to-id');

        $this->jsonRequest('GET', '/community/decks/'.$publicSlug.'/analysis');
        self::assertResponseIsSuccessful();
        self::assertFalse($this->jsonResponse()['snapshot']['hit']);
        $snapshotId = $this->snapshotId($deckId);

        $this->jsonRequest('GET', '/decks/'.$deckId.'/analysis/advanced', token: $token);

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertTrue($response['snapshot']['hit']);
        self::assertSame('fresh', $response['snapshot']['reason']);
        self::assertSame($snapshotId, $this->snapshotId($deckId));
        self::assertSame('1', (string) $this->connection()->fetchOne(
            'SELECT COUNT(*) FROM deck_advanced_analysis_snapshot WHERE deck_id = :deckId',
            ['deckId' => $deckId],
        ));
    }

    public function testPrivateDeckSlugDoesNotExposeAdvancedAnalysis(): void
    {
        [, $privateDeckId, $privateSlug] = $this->advancedDeckFixture('private-community', 'private', false);

        $this->jsonRequest('GET', '/community/decks/'.$privateSlug.'/analysis');

        self::assertResponseStatusCodeSame(404);
        self::assertSame('0', (string) $this->connection()->fetchOne(
            'SELECT COUNT(*) FROM deck_advanced_analysis_snapshot WHERE deck_id = :deckId',
            ['deckId' => $privateDeckId],
        ));
    }

    public function testMissingCommunitySlugReturnsNotFound(): void
    {
        $this->jsonRequest('GET', '/community/decks/missing-public-deck/analysis');

        self::assertResponseStatusCodeSame(404);
    }

    public function testCommunityEndpointDoesNotCreateExternalSyncRuns(): void
    {
        [, , $publicSlug] = $this->publicAdvancedDeckFixture('no-external-sync');

        $this->jsonRequest('GET', '/community/decks/'.$publicSlug.'/analysis');

        self::assertResponseIsSuccessful();
        self::assertSame('0', (string) $this->connection()->fetchOne('SELECT COUNT(*) FROM external_sync_run'));
    }

    public function testSimpleAndOwnedAdvancedEndpointsStillWorkAfterCommunityAdvancedAnalysis(): void
    {
        [$token, $deckId, $publicSlug] = $this->publicAdvancedDeckFixture('no-regression');

        $this->jsonRequest('GET', '/community/decks/'.$publicSlug.'/analysis');
        self::assertResponseIsSuccessful();

        $this->jsonRequest('GET', '/decks/'.$deckId.'/analysis', token: $token);
        self::assertResponseIsSuccessful();
        $simple = $this->jsonResponse();
        self::assertArrayHasKey('manaCurve', $simple);
        self::assertArrayNotHasKey('snapshot', $simple);

        $this->jsonRequest('GET', '/decks/'.$deckId.'/analysis/advanced', token: $token);
        self::assertResponseIsSuccessful();
        self::assertTrue($this->jsonResponse()['snapshot']['hit']);
    }

    /**
     * @return array{0:string,1:string,2:string}
     */
    private function publicAdvancedDeckFixture(string $suffix): array
    {
        return $this->advancedDeckFixture($suffix, 'public', true);
    }

    /**
     * @return array{0:string,1:string,2:string}
     */
    private function advancedDeckFixture(string $suffix, string $visibility, bool $validate): array
    {
        $token = $this->registerAndLogin('community-advanced-'.$suffix.'@example.test', substr('ComAdv'.$suffix, 0, 20));
        $commander = $this->advancedCard('8a000000-0000-0000-0000-'.substr(md5($suffix.'commander'), 0, 12), 'Community Commander '.$suffix, [
            'type_line' => 'Legendary Creature - Human',
            'oracle_id' => '8a000000-0000-0000-0001-'.substr(md5($suffix.'commander'), 0, 12),
        ]);
        $mainCard = $this->advancedCard('8b000000-0000-0000-0000-'.substr(md5($suffix.'main'), 0, 12), 'Community Main '.$suffix, [
            'type_line' => 'Basic Land - Island',
            'oracle_id' => '8b000000-0000-0000-0001-'.substr(md5($suffix.'main'), 0, 12),
        ]);

        $this->jsonRequest('POST', '/decks/quick-build', [
            'name' => 'Adv '.substr(md5($suffix), 0, 8),
            'visibility' => $visibility,
            'cards' => [
                ['scryfallId' => $commander->scryfallId(), 'quantity' => 1, 'section' => 'commander'],
                ['scryfallId' => $mainCard->scryfallId(), 'quantity' => 99, 'section' => 'main'],
            ],
        ], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        if ($validate) {
            $this->jsonRequest('POST', '/decks/'.$deckId.'/validate-commander', token: $token);
            self::assertResponseIsSuccessful();
            self::assertTrue($this->jsonResponse()['valid']);
        }

        $slugColumn = $visibility === 'public' ? 'public_slug' : 'slug';
        $slug = (string) $this->connection()->fetchOne(
            sprintf('SELECT %s FROM deck WHERE id = :deckId', $slugColumn),
            ['deckId' => $deckId],
        );
        self::assertNotSame('', $slug);

        return [$token, $deckId, $slug];
    }

    /**
     * @param array<string,mixed> $overrides
     */
    private function advancedCard(string $scryfallId, string $name, array $overrides): Card
    {
        $card = $this->seedCard($scryfallId, $name, $overrides);
        $this->insertAnalysisProfile($card->oracleId(), $name);

        return $card;
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

    /**
     * @param array<string,mixed> $response
     */
    private function assertAdvancedAnalysisContract(array $response): void
    {
        foreach ([
            'deckId',
            'analyzerVersion',
            'analyzedAt',
            'snapshot',
            'summary',
            'health',
            'metrics',
            'consistency',
            'combos',
            'topComboCompleters',
            'archetypes',
            'power',
            'issues',
            'recommendations',
            'unmatchedCards',
        ] as $key) {
            self::assertArrayHasKey($key, $response);
        }
    }

    private function snapshotId(string $deckId): string
    {
        return (string) $this->connection()->fetchOne(
            'SELECT id FROM deck_advanced_analysis_snapshot WHERE deck_id = :deckId',
            ['deckId' => $deckId],
        );
    }

    private function connection(): Connection
    {
        return $this->entityManager->getConnection();
    }
}
