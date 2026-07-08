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
        self::assertArrayHasKey('manaDataVersion', $response['snapshot']);
        self::assertArrayHasKey('mana', $response['metrics']);
        self::assertArrayHasKey('mana', $response['health']);
        self::assertArrayHasKey('colorAccess', $response['consistency']);
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
        $ownedResponse = $this->jsonResponse();
        self::assertFalse($ownedResponse['snapshot']['hit']);
        $ownedManaVersion = $ownedResponse['snapshot']['manaDataVersion'];
        $snapshotId = $this->snapshotId($deckId);

        $this->jsonRequest('GET', '/community/decks/'.$publicSlug.'/analysis');

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertTrue($response['snapshot']['hit']);
        self::assertSame('fresh', $response['snapshot']['reason']);
        self::assertSame($ownedManaVersion, $response['snapshot']['manaDataVersion']);
        self::assertSame($snapshotId, $this->snapshotId($deckId));
        self::assertSame($ownedManaVersion, (string) $this->connection()->fetchOne(
            'SELECT mana_data_version FROM deck_advanced_analysis_snapshot WHERE deck_id = :deckId',
            ['deckId' => $deckId],
        ));
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

    public function testCommunityAdvancedAnalysisRouteIsNotExposed(): void
    {
        [, , $publicSlug] = $this->publicAdvancedDeckFixture('no-advanced-suffix');

        $this->jsonRequest('GET', '/community/decks/'.$publicSlug.'/analysis/advanced');

        self::assertResponseStatusCodeSame(404);
    }

    public function testCommunityAnalysisIncludesRenderableFetchlandDetails(): void
    {
        [$token, $deckId, $publicSlug] = $this->publicFetchlandDeckFixture('fetchland-visuals');

        $this->jsonRequest('GET', '/community/decks/'.$publicSlug.'/analysis');

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame($deckId, $response['deckId']);
        self::assertArrayHasKey('mana', $response['metrics']);
        self::assertArrayHasKey('mana', $response['health']);
        self::assertArrayHasKey('colorAccess', $response['consistency']);
        self::assertArrayHasKey('manaDataVersion', $response['snapshot']);

        $details = $response['metrics']['mana']['fetchlands']['details'];
        self::assertCount(1, $details);
        $detail = $details[0];
        self::assertArrayNotHasKey('fetchland', $detail);
        self::assertNotEmpty($detail['oracleId']);
        self::assertArrayNotHasKey('cardId', $detail);
        self::assertArrayNotHasKey('name', $detail);
        self::assertArrayNotHasKey('imageUrl', $detail);
        self::assertArrayNotHasKey('validTargets', $detail);
        self::assertIsArray($detail['effectiveColors']);
        self::assertIsArray($detail['untappedEffectiveColors']);
        self::assertIsArray($detail['tappedOnlyEffectiveColors']);

        $this->jsonRequest('GET', '/decks/'.$deckId.'/analysis/advanced', token: $token);
        self::assertResponseIsSuccessful();
        self::assertTrue($this->jsonResponse()['snapshot']['hit']);
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
    private function publicFetchlandDeckFixture(string $suffix): array
    {
        $token = $this->registerAndLogin('community-fetch-'.$suffix.'@example.test', substr('ComFetch'.$suffix, 0, 20));
        $commander = $this->advancedCard('8c000000-0000-0000-0000-'.substr(md5($suffix.'commander'), 0, 12), 'Community Fetch Commander '.$suffix, [
            'type_line' => 'Legendary Creature - Human',
            'oracle_id' => '8c000000-0000-0000-0001-'.substr(md5($suffix.'commander'), 0, 12),
        ]);
        $fetch = $this->advancedCard('8d000000-0000-0000-0000-'.substr(md5($suffix.'fetch'), 0, 12), 'Wooded Foothills', [
            'type_line' => 'Land',
            'oracle_id' => '8d000000-0000-0000-0001-'.substr(md5($suffix.'fetch'), 0, 12),
        ]);
        $shock = $this->advancedCard('8e000000-0000-0000-0000-'.substr(md5($suffix.'shock'), 0, 12), 'Stomping Ground', [
            'type_line' => 'Land - Mountain Forest',
            'oracle_id' => '8e000000-0000-0000-0001-'.substr(md5($suffix.'shock'), 0, 12),
        ]);
        $battle = $this->advancedCard('8f000000-0000-0000-0000-'.substr(md5($suffix.'battle'), 0, 12), 'Cinder Glade', [
            'type_line' => 'Land - Mountain Forest',
            'oracle_id' => '8f000000-0000-0000-0001-'.substr(md5($suffix.'battle'), 0, 12),
        ]);
        $filler = $this->advancedCard('81000000-0000-0000-0000-'.substr(md5($suffix.'filler'), 0, 12), 'Community Filler Forest '.$suffix, [
            'type_line' => 'Basic Land - Forest',
            'oracle_id' => '81000000-0000-0000-0001-'.substr(md5($suffix.'filler'), 0, 12),
        ]);

        $this->insertManaProfile($fetch->oracleId(), 'Wooded Foothills', fetchableTypes: ['Mountain', 'Forest'], isFetchland: true, cycle: 'fetchland');
        $this->insertManaProfile($shock->oracleId(), 'Stomping Ground', colors: ['R', 'G'], basicTypes: ['Mountain', 'Forest'], cycle: 'shockland', canEnterUntapped: true);
        $this->insertManaProfile($battle->oracleId(), 'Cinder Glade', colors: ['R', 'G'], basicTypes: ['Mountain', 'Forest'], cycle: 'battle_land', conditional: true, canEnterUntapped: true);
        $this->insertManaProfile($filler->oracleId(), 'Community Filler Forest '.$suffix, colors: ['G'], basicTypes: ['Forest'], cycle: 'basic', basic: true, canEnterUntapped: true);

        $this->jsonRequest('POST', '/decks/quick-build', [
            'name' => 'Fetch '.substr(md5($suffix), 0, 8),
            'visibility' => 'public',
            'cards' => [
                ['scryfallId' => $commander->scryfallId(), 'quantity' => 1, 'section' => 'commander'],
                ['scryfallId' => $fetch->scryfallId(), 'quantity' => 1, 'section' => 'main'],
                ['scryfallId' => $shock->scryfallId(), 'quantity' => 1, 'section' => 'main'],
                ['scryfallId' => $battle->scryfallId(), 'quantity' => 1, 'section' => 'main'],
                ['scryfallId' => $filler->scryfallId(), 'quantity' => 96, 'section' => 'main'],
            ],
        ], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        $this->jsonRequest('POST', '/decks/'.$deckId.'/validate-commander', token: $token);
        self::assertResponseIsSuccessful();
        self::assertTrue($this->jsonResponse()['valid']);

        $slug = (string) $this->connection()->fetchOne(
            'SELECT public_slug FROM deck WHERE id = :deckId',
            ['deckId' => $deckId],
        );
        self::assertNotSame('', $slug);

        return [$token, $deckId, $slug];
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
     * @param list<string> $colors
     * @param list<string> $basicTypes
     * @param list<string> $fetchableTypes
     */
    private function insertManaProfile(
        ?string $oracleId,
        string $name,
        array $colors = [],
        array $basicTypes = [],
        array $fetchableTypes = [],
        bool $isFetchland = false,
        string $cycle = 'land',
        bool $basic = false,
        bool $conditional = false,
        bool $canEnterUntapped = false,
    ): void {
        self::assertNotNull($oracleId);
        $this->connection()->executeStatement(
            <<<'SQL'
INSERT INTO card_mana_profile (
    oracle_id,
    name,
    type_line,
    is_land,
    is_basic_land,
    is_nonbasic_land,
    is_fetchland,
    is_typed_land,
    basic_land_types,
    produced_mana_colors,
    enters_tapped_conditionally,
    can_enter_untapped,
    mana_source_category,
    land_cycle_type,
    land_speed_profile,
    fetchable_land_types,
    updated_at
) VALUES (
    :oracle_id,
    :name,
    :type_line,
    true,
    :is_basic_land,
    :is_nonbasic_land,
    :is_fetchland,
    :is_typed_land,
    :basic_land_types::jsonb,
    :produced_mana_colors::jsonb,
    :enters_tapped_conditionally,
    :can_enter_untapped,
    :mana_source_category,
    :land_cycle_type,
    :land_speed_profile,
    :fetchable_land_types::jsonb,
    NOW()
)
SQL,
            [
                'oracle_id' => $oracleId,
                'name' => $name,
                'type_line' => $basicTypes === [] ? 'Land' : 'Land - '.implode(' ', $basicTypes),
                'is_basic_land' => $basic,
                'is_nonbasic_land' => !$basic,
                'is_fetchland' => $isFetchland,
                'is_typed_land' => $basicTypes !== [],
                'basic_land_types' => json_encode($basicTypes, JSON_THROW_ON_ERROR),
                'produced_mana_colors' => json_encode($colors, JSON_THROW_ON_ERROR),
                'enters_tapped_conditionally' => $conditional,
                'can_enter_untapped' => $canEnterUntapped,
                'mana_source_category' => $isFetchland ? 'fetchland' : 'land',
                'land_cycle_type' => $cycle,
                'land_speed_profile' => $canEnterUntapped ? 'always_untapped' : 'unknown',
                'fetchable_land_types' => json_encode($fetchableTypes, JSON_THROW_ON_ERROR),
            ],
            [
                'is_basic_land' => \Doctrine\DBAL\ParameterType::BOOLEAN,
                'is_nonbasic_land' => \Doctrine\DBAL\ParameterType::BOOLEAN,
                'is_fetchland' => \Doctrine\DBAL\ParameterType::BOOLEAN,
                'is_typed_land' => \Doctrine\DBAL\ParameterType::BOOLEAN,
                'enters_tapped_conditionally' => \Doctrine\DBAL\ParameterType::BOOLEAN,
                'can_enter_untapped' => \Doctrine\DBAL\ParameterType::BOOLEAN,
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
            'unmatchedCards',
        ] as $key) {
            self::assertArrayHasKey($key, $response);
        }
        self::assertArrayNotHasKey('recommendations', $response);
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
