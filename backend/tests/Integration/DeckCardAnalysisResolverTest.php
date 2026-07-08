<?php

namespace App\Tests\Integration;

use App\Application\Deck\DeckCardAnalysisResolver;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\User\User;

final class DeckCardAnalysisResolverTest extends ApiTestCase
{
    public function testResolverReturnsAnalysisProfileForResolvedDeckCards(): void
    {
        $card = $this->seedCard('98000000-0000-0000-0000-000000000001', 'Resolved Advanced Card', [
            'oracle_id' => '98000000-0000-0000-0001-000000000001',
            'mana_cost' => '{1}{U}',
            'type_line' => 'Instant',
        ]);
        $this->insertAnalysisProfile($card->oracleId(), 'Resolved Advanced Card', [
            'roles' => ['interaction'],
            'is_instant' => true,
        ]);
        $deck = $this->deckWithCard('resolver-normal', $card, 2, DeckCard::SECTION_MAIN);

        $result = (new DeckCardAnalysisResolver($this->entityManager->getConnection()))->resolve($deck->id());

        self::assertSame($deck->id(), $result['deckId']);
        self::assertCount(1, $result['resolvedCards']);
        self::assertSame([], $result['unmatchedCards']);
        self::assertSame($card->id(), $result['resolvedCards'][0]['cardId']);
        self::assertSame($card->oracleId(), $result['resolvedCards'][0]['oracleId']);
        self::assertSame(2, $result['resolvedCards'][0]['quantity']);
        self::assertSame(['interaction'], $result['resolvedCards'][0]['analysisProfile']['roles']);
        self::assertTrue($result['resolvedCards'][0]['analysisProfile']['types']['instant']);
    }

    public function testResolverToleratesCardWithoutOracleId(): void
    {
        $card = $this->seedCard('98000000-0000-0000-0000-000000000002', 'No Oracle Advanced Card', [
            'oracle_id' => null,
        ]);
        $deck = $this->deckWithCard('resolver-no-oracle', $card, 1, DeckCard::SECTION_MAIN);

        $result = (new DeckCardAnalysisResolver($this->entityManager->getConnection()))->resolve($deck->id());

        self::assertSame([], $result['resolvedCards']);
        self::assertCount(1, $result['unmatchedCards']);
        self::assertSame('missing_oracle_id', $result['unmatchedCards'][0]['reason']);
        self::assertSame($card->id(), $result['unmatchedCards'][0]['cardId']);
    }

    public function testResolverToleratesCardWithoutAnalysisProfile(): void
    {
        $card = $this->seedCard('98000000-0000-0000-0000-000000000003', 'No Profile Advanced Card', [
            'oracle_id' => '98000000-0000-0000-0001-000000000003',
        ]);
        $deck = $this->deckWithCard('resolver-no-profile', $card, 3, DeckCard::SECTION_COMMANDER);

        $result = (new DeckCardAnalysisResolver($this->entityManager->getConnection()))->resolve($deck->id());

        self::assertSame([], $result['resolvedCards']);
        self::assertCount(1, $result['unmatchedCards']);
        self::assertSame('missing_analysis_profile', $result['unmatchedCards'][0]['reason']);
        self::assertSame(3, $result['unmatchedCards'][0]['quantity']);
        self::assertSame(DeckCard::SECTION_COMMANDER, $result['unmatchedCards'][0]['section']);
    }

    private function deckWithCard(string $suffix, \App\Domain\Card\Card $card, int $quantity, string $section): Deck
    {
        $user = new User('advanced-resolver-'.$suffix.'@example.test', substr('AdvResolver'.$suffix, 0, 20));
        $user->setPassword('hash');
        $deck = new Deck($user, 'Advanced Resolver '.$suffix);
        $deck->addOrIncrementCard($card, $quantity, $section);
        $this->entityManager->persist($user);
        $this->entityManager->persist($deck);
        $this->entityManager->flush();

        return $deck;
    }

    /**
     * @param array<string,mixed> $overrides
     */
    private function insertAnalysisProfile(?string $oracleId, string $name, array $overrides = []): void
    {
        self::assertNotNull($oracleId);
        $values = array_replace([
            'oracle_id' => $oracleId,
            'name' => $name,
            'normalized_name' => mb_strtolower($name),
            'mana_cost' => '{1}',
            'mana_value' => 1,
            'type_line' => 'Artifact',
            'colors' => json_encode([], JSON_THROW_ON_ERROR),
            'color_identity' => json_encode([], JSON_THROW_ON_ERROR),
            'produced_mana' => json_encode([], JSON_THROW_ON_ERROR),
            'keywords' => json_encode([], JSON_THROW_ON_ERROR),
            'commander_legal' => true,
            'commander_banned' => false,
            'can_be_commander' => false,
            'is_land' => false,
            'is_creature' => false,
            'is_artifact' => true,
            'is_enchantment' => false,
            'is_instant' => false,
            'is_sorcery' => false,
            'is_planeswalker' => false,
            'is_battle' => false,
            'is_legendary' => false,
            'edhrec_rank' => null,
            'is_game_changer' => false,
            'roles' => json_encode([], JSON_THROW_ON_ERROR),
            'subroles' => json_encode([], JSON_THROW_ON_ERROR),
            'role_scores' => json_encode([], JSON_THROW_ON_ERROR),
            'condition_keys' => json_encode([], JSON_THROW_ON_ERROR),
            'archetype_weights' => json_encode([], JSON_THROW_ON_ERROR),
            'power_flags' => json_encode([], JSON_THROW_ON_ERROR),
            'is_fast_mana' => false,
            'is_free_interaction' => false,
            'is_efficient_tutor' => false,
            'is_cedh_staple' => false,
            'analysis_hash' => hash('sha256', $oracleId),
        ], $this->jsonProfileOverrides($overrides));
        $values = $this->stringBooleanValues($values);

        $this->entityManager->getConnection()->executeStatement(
            <<<'SQL'
INSERT INTO card_analysis_profile (
    oracle_id,
    name,
    normalized_name,
    mana_cost,
    mana_value,
    type_line,
    colors,
    color_identity,
    produced_mana,
    keywords,
    commander_legal,
    commander_banned,
    can_be_commander,
    is_land,
    is_creature,
    is_artifact,
    is_enchantment,
    is_instant,
    is_sorcery,
    is_planeswalker,
    is_battle,
    is_legendary,
    edhrec_rank,
    is_game_changer,
    roles,
    subroles,
    role_scores,
    condition_keys,
    archetype_weights,
    power_flags,
    is_fast_mana,
    is_free_interaction,
    is_efficient_tutor,
    is_cedh_staple,
    analysis_hash,
    updated_at
) VALUES (
    :oracle_id,
    :name,
    :normalized_name,
    :mana_cost,
    :mana_value,
    :type_line,
    :colors::jsonb,
    :color_identity::jsonb,
    :produced_mana::jsonb,
    :keywords::jsonb,
    :commander_legal,
    :commander_banned,
    :can_be_commander,
    :is_land,
    :is_creature,
    :is_artifact,
    :is_enchantment,
    :is_instant,
    :is_sorcery,
    :is_planeswalker,
    :is_battle,
    :is_legendary,
    :edhrec_rank,
    :is_game_changer,
    :roles::jsonb,
    :subroles::jsonb,
    :role_scores::jsonb,
    :condition_keys::jsonb,
    :archetype_weights::jsonb,
    :power_flags::jsonb,
    :is_fast_mana,
    :is_free_interaction,
    :is_efficient_tutor,
    :is_cedh_staple,
    :analysis_hash,
    NOW()
)
SQL,
            $values,
        );
    }

    /**
     * @param array<string,mixed> $overrides
     * @return array<string,mixed>
     */
    private function jsonProfileOverrides(array $overrides): array
    {
        foreach (['colors', 'color_identity', 'produced_mana', 'keywords', 'roles', 'subroles', 'role_scores', 'condition_keys', 'archetype_weights', 'power_flags'] as $key) {
            if (array_key_exists($key, $overrides) && is_array($overrides[$key])) {
                $overrides[$key] = json_encode($overrides[$key], JSON_THROW_ON_ERROR);
            }
        }

        return $overrides;
    }

    /**
     * @param array<string,mixed> $values
     * @return array<string,mixed>
     */
    private function stringBooleanValues(array $values): array
    {
        foreach ($values as $key => $value) {
            if (is_bool($value)) {
                $values[$key] = $value ? 'true' : 'false';
            }
        }

        return $values;
    }
}
