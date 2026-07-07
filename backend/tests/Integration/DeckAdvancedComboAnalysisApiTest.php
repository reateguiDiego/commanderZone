<?php

namespace App\Tests\Integration;

use App\Domain\Card\Card;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\User\User;
use Doctrine\DBAL\ParameterType;

final class DeckAdvancedComboAnalysisApiTest extends ApiTestCase
{
    public function testOracleConsultationCompleteComboIsDetectedAsWin(): void
    {
        [$token, $deck] = $this->deckWithCards('oracle-complete', [
            $this->cardFixture('Thassa\'s Oracle', '91000000-0000-0000-0000-000000000101'),
            $this->cardFixture('Demonic Consultation', '91000000-0000-0000-0000-000000000102'),
        ]);
        $this->insertComboProfile('91000000-0000-0000-0000-000000000001', 'oracle-consultation', [
            '91000000-0000-0000-0000-000000000101',
            '91000000-0000-0000-0000-000000000102',
        ], ['win_game'], producesWin: true, power: 80, complexity: 20);

        $response = $this->advancedAnalysis($token, $deck);

        self::assertSame(1, $response['combos']['completeCount']);
        self::assertSame(1, $response['combos']['winLikeCount']);
        self::assertSame('oracle-consultation', $response['combos']['complete'][0]['externalId']);
        self::assertTrue($response['combos']['complete'][0]['producesWin']);
        self::assertSame([], $response['combos']['complete'][0]['missingOracleIds']);
    }

    public function testOracleOnlyReportsConsultationAndPactAsOneMissingPartials(): void
    {
        [$token, $deck] = $this->deckWithCards('oracle-only', [
            $this->cardFixture('Thassa\'s Oracle', '91000000-0000-0000-0000-000000000201'),
        ]);
        $this->insertCardAnalysisProfile('91000000-0000-0000-0000-000000000202', 'Demonic Consultation');
        $this->insertCardAnalysisProfile('91000000-0000-0000-0000-000000000203', 'Tainted Pact');
        $this->insertComboProfile('91000000-0000-0000-0000-000000000002', 'oracle-consultation', [
            '91000000-0000-0000-0000-000000000201',
            '91000000-0000-0000-0000-000000000202',
        ], ['win_game'], producesWin: true, power: 80, complexity: 20);
        $this->insertComboProfile('91000000-0000-0000-0000-000000000003', 'oracle-pact', [
            '91000000-0000-0000-0000-000000000201',
            '91000000-0000-0000-0000-000000000203',
        ], ['win_game'], producesWin: true, power: 80, complexity: 20);

        $response = $this->advancedAnalysis($token, $deck);

        self::assertSame(0, $response['combos']['completeCount']);
        self::assertSame(2, $response['combos']['partialOneMissingCount']);
        self::assertSame(['Demonic Consultation', 'Tainted Pact'], array_column($response['topComboCompleters'], 'name'));
    }

    public function testIsochronScepterDramaticReversalDetectsInfiniteMana(): void
    {
        [$token, $deck] = $this->deckWithCards('scepter-reversal', [
            $this->cardFixture('Isochron Scepter', '91000000-0000-0000-0000-000000000301'),
            $this->cardFixture('Dramatic Reversal', '91000000-0000-0000-0000-000000000302'),
        ]);
        $this->insertComboProfile('91000000-0000-0000-0000-000000000004', 'scepter-reversal', [
            '91000000-0000-0000-0000-000000000301',
            '91000000-0000-0000-0000-000000000302',
        ], ['infinite_mana'], producesInfiniteMana: true, power: 60, complexity: 35);

        $response = $this->advancedAnalysis($token, $deck);

        self::assertSame(1, $response['combos']['completeCount']);
        self::assertSame(1, $response['combos']['infiniteManaCount']);
        self::assertTrue($response['combos']['complete'][0]['producesInfiniteMana']);
    }

    public function testExquisiteBloodSanguineBondDetectsLethalWinLikeLoop(): void
    {
        [$token, $deck] = $this->deckWithCards('blood-bond', [
            $this->cardFixture('Exquisite Blood', '91000000-0000-0000-0000-000000000401'),
            $this->cardFixture('Sanguine Bond', '91000000-0000-0000-0000-000000000402'),
        ]);
        $this->insertComboProfile('91000000-0000-0000-0000-000000000005', 'blood-bond', [
            '91000000-0000-0000-0000-000000000401',
            '91000000-0000-0000-0000-000000000402',
        ], ['lethal_loop'], power: 45, complexity: 35);

        $response = $this->advancedAnalysis($token, $deck);

        self::assertSame(1, $response['combos']['completeCount']);
        self::assertSame(1, $response['combos']['winLikeCount']);
        self::assertSame(1, $response['combos']['lethalLoopCount']);
        self::assertTrue($response['combos']['complete'][0]['producesWinLike']);
        self::assertTrue($response['combos']['complete'][0]['lethalLoop']);
    }

    public function testManyComboPiecesWithoutCompleteComboCreatesWarningWithoutArchetype(): void
    {
        [$token, $deck] = $this->deckWithCards('loose-pieces', [
            $this->cardFixture('Loose Piece 1', '91000000-0000-0000-0000-000000000501', roles: ['combo_piece']),
            $this->cardFixture('Loose Piece 2', '91000000-0000-0000-0000-000000000502', roles: ['combo_piece']),
            $this->cardFixture('Loose Piece 3', '91000000-0000-0000-0000-000000000503', roles: ['combo_piece']),
            $this->cardFixture('Loose Piece 4', '91000000-0000-0000-0000-000000000504', roles: ['combo_piece']),
            $this->cardFixture('Loose Piece 5', '91000000-0000-0000-0000-000000000505', roles: ['combo_piece']),
            $this->cardFixture('Loose Piece 6', '91000000-0000-0000-0000-000000000506', roles: ['combo_piece']),
        ]);
        $this->insertComboProfile('91000000-0000-0000-0000-000000000006', 'loose-three-card-line', [
            '91000000-0000-0000-0000-000000000501',
            '91000000-0000-0000-0000-000000000591',
            '91000000-0000-0000-0000-000000000592',
        ], ['win_game'], producesWin: true, power: 50, complexity: 60);

        $response = $this->advancedAnalysis($token, $deck);

        self::assertSame(0, $response['combos']['completeCount']);
        self::assertContains('combo_pieces_without_complete_combos', array_column($response['issues'], 'code'));
        self::assertNotSame('combo', $response['archetypes']['primary']);
        self::assertNotSame('combo', $response['summary']['primaryArchetype']);
    }

    public function testComboDetailsAreLimitedButTotalsRemainComplete(): void
    {
        [$token, $deck] = $this->deckWithCards('combo-limit', [
            $this->cardFixture('Shared Combo Piece', '91000000-0000-0000-0000-000000000601'),
        ]);

        for ($i = 1; $i <= 25; ++$i) {
            $missingOracleId = sprintf('91000000-0000-0000-0000-0000000006%02d', $i + 10);
            $this->insertCardAnalysisProfile($missingOracleId, 'Completer '.$i);
            $this->insertComboProfile(sprintf('91000000-0000-0000-0000-0000000007%02d', $i), 'limit-'.$i, [
                '91000000-0000-0000-0000-000000000601',
                $missingOracleId,
            ], ['win_game'], producesWin: true, power: 50 + $i, complexity: 20);
        }

        $response = $this->advancedAnalysis($token, $deck);

        self::assertSame(25, $response['combos']['partialOneMissingCount']);
        self::assertCount(20, $response['combos']['partialOneMissing']);
        self::assertCount(20, $response['topComboCompleters']);
    }

    public function testDetectorUsesLocalComboProfilesOnly(): void
    {
        [$token, $deck] = $this->deckWithCards('local-only', [
            $this->cardFixture('Local Piece A', '91000000-0000-0000-0000-000000000801'),
            $this->cardFixture('Local Piece B', '91000000-0000-0000-0000-000000000802'),
        ]);
        $this->insertComboProfile('91000000-0000-0000-0000-000000000008', 'local-profile-combo', [
            '91000000-0000-0000-0000-000000000801',
            '91000000-0000-0000-0000-000000000802',
        ], ['infinite_tokens'], producesInfiniteTokens: true);

        $response = $this->advancedAnalysis($token, $deck);

        self::assertSame(1, $response['combos']['completeCount']);
        self::assertSame('local-profile-combo', $response['combos']['complete'][0]['externalId']);
        self::assertSame('0', (string) $this->connection()->fetchOne('SELECT COUNT(*) FROM external_sync_run'));
    }

    /**
     * @param list<array{card:Card,roles:list<string>}> $fixtures
     * @return array{0:string,1:Deck}
     */
    private function deckWithCards(string $suffix, array $fixtures): array
    {
        $token = $this->registerAndLogin('advanced-combo-'.$suffix.'@example.test', substr('Combo'.$suffix, 0, 20));
        $user = $this->entityManager->getRepository(User::class)->find($this->currentUserId($token));
        self::assertInstanceOf(User::class, $user);
        $deck = new Deck($user, 'Advanced Combo '.$suffix);

        foreach ($fixtures as $fixture) {
            $card = $this->entityManager->getRepository(Card::class)->find($fixture['card']->id());
            self::assertInstanceOf(Card::class, $card);
            $deck->addOrIncrementCard($card, 1, DeckCard::SECTION_MAIN);
        }

        $this->entityManager->persist($deck);
        $this->entityManager->flush();

        return [$token, $deck];
    }

    /**
     * @param list<string> $roles
     * @return array{card:Card,roles:list<string>}
     */
    private function cardFixture(string $name, string $oracleId, array $roles = []): array
    {
        $scryfallId = str_replace('91000000', '92000000', $oracleId);
        $card = $this->seedCard($scryfallId, $name, ['oracle_id' => $oracleId]);
        $this->insertCardAnalysisProfile($oracleId, $name, $roles);

        return ['card' => $card, 'roles' => $roles];
    }

    /**
     * @return array<string,mixed>
     */
    private function advancedAnalysis(string $token, Deck $deck): array
    {
        $this->jsonRequest('GET', '/decks/'.$deck->id().'/analysis/advanced', token: $token);
        self::assertResponseIsSuccessful();

        return $this->jsonResponse();
    }

    /**
     * @param list<string> $roles
     */
    private function insertCardAnalysisProfile(string $oracleId, string $name, array $roles = []): void
    {
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
    :roles::jsonb,
    '[]'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    :analysis_hash,
    NOW()
)
ON CONFLICT (oracle_id) DO UPDATE SET
    name = EXCLUDED.name,
    normalized_name = EXCLUDED.normalized_name,
    roles = EXCLUDED.roles,
    analysis_hash = EXCLUDED.analysis_hash,
    updated_at = NOW()
SQL,
            [
                'oracle_id' => $oracleId,
                'name' => $name,
                'normalized_name' => mb_strtolower($name),
                'roles' => json_encode($roles, JSON_THROW_ON_ERROR),
                'analysis_hash' => hash('sha256', $oracleId.'|'.$name),
            ],
        );

        $this->connection()->executeStatement(
            <<<'SQL'
INSERT INTO card_oracle_profile (
    oracle_id,
    name,
    normalized_name,
    colors,
    color_identity,
    produced_mana,
    keywords,
    card_faces,
    commander_legal,
    data_hash,
    updated_at
) VALUES (
    :oracle_id,
    :name,
    :normalized_name,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    true,
    :data_hash,
    NOW()
)
ON CONFLICT (oracle_id) DO UPDATE SET
    name = EXCLUDED.name,
    normalized_name = EXCLUDED.normalized_name,
    data_hash = EXCLUDED.data_hash,
    updated_at = NOW()
SQL,
            [
                'oracle_id' => $oracleId,
                'name' => $name,
                'normalized_name' => mb_strtolower($name),
                'data_hash' => hash('sha256', 'oracle|'.$oracleId.'|'.$name),
            ],
        );
    }

    /**
     * @param list<string> $requiredOracleIds
     * @param list<string> $features
     */
    private function insertComboProfile(
        string $comboVariantId,
        string $externalId,
        array $requiredOracleIds,
        array $features,
        bool $producesWin = false,
        bool $producesInfiniteMana = false,
        bool $producesInfiniteDamage = false,
        bool $producesInfiniteTokens = false,
        bool $requiresCommander = false,
        bool $requiresTemplate = false,
        int $power = 40,
        int $complexity = 40,
    ): void {
        $this->connection()->executeStatement(
            <<<'SQL'
INSERT INTO spellbook_combo_variant (
    id,
    external_id,
    identity,
    status,
    popularity,
    bracket_tag,
    source_hash,
    synced_at
) VALUES (
    :id,
    :external_id,
    '[]'::jsonb,
    'OK',
    :popularity,
    'E',
    :source_hash,
    NOW()
)
ON CONFLICT (id) DO NOTHING
SQL,
            [
                'id' => $comboVariantId,
                'external_id' => $externalId,
                'popularity' => 100,
                'source_hash' => hash('sha256', $externalId),
            ],
        );

        $this->connection()->executeStatement(
            <<<'SQL'
INSERT INTO combo_analysis_profile (
    combo_variant_id,
    external_id,
    required_oracle_ids,
    required_count,
    combo_size,
    identity,
    features,
    produces_win,
    produces_infinite_mana,
    produces_infinite_damage,
    produces_infinite_tokens,
    produces_infinite_draw,
    produces_mill,
    produces_lock,
    requires_commander,
    requires_graveyard,
    requires_battlefield,
    requires_template,
    popularity,
    bracket_tag,
    combo_power_score,
    combo_complexity_score,
    analysis_hash,
    updated_at
) VALUES (
    :combo_variant_id,
    :external_id,
    :required_oracle_ids::jsonb,
    :required_count,
    :combo_size,
    '[]'::jsonb,
    :features::jsonb,
    :produces_win,
    :produces_infinite_mana,
    :produces_infinite_damage,
    :produces_infinite_tokens,
    false,
    false,
    false,
    :requires_commander,
    false,
    false,
    :requires_template,
    100,
    'E',
    :combo_power_score,
    :combo_complexity_score,
    :analysis_hash,
    NOW()
)
SQL,
            [
                'combo_variant_id' => $comboVariantId,
                'external_id' => $externalId,
                'required_oracle_ids' => json_encode($requiredOracleIds, JSON_THROW_ON_ERROR),
                'required_count' => count($requiredOracleIds),
                'combo_size' => count($requiredOracleIds),
                'features' => json_encode($features, JSON_THROW_ON_ERROR),
                'produces_win' => $producesWin,
                'produces_infinite_mana' => $producesInfiniteMana,
                'produces_infinite_damage' => $producesInfiniteDamage,
                'produces_infinite_tokens' => $producesInfiniteTokens,
                'requires_commander' => $requiresCommander,
                'requires_template' => $requiresTemplate,
                'combo_power_score' => $power,
                'combo_complexity_score' => $complexity,
                'analysis_hash' => hash('sha256', $comboVariantId.'|'.$externalId),
            ],
            [
                'produces_win' => ParameterType::BOOLEAN,
                'produces_infinite_mana' => ParameterType::BOOLEAN,
                'produces_infinite_damage' => ParameterType::BOOLEAN,
                'produces_infinite_tokens' => ParameterType::BOOLEAN,
                'requires_commander' => ParameterType::BOOLEAN,
                'requires_template' => ParameterType::BOOLEAN,
            ],
        );
    }

    private function connection(): \Doctrine\DBAL\Connection
    {
        return $this->entityManager->getConnection();
    }
}
