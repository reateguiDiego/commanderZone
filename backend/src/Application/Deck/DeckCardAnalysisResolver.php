<?php

namespace App\Application\Deck;

use App\Domain\Deck\DeckCard;
use Doctrine\DBAL\Connection;

final class DeckCardAnalysisResolver
{
    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * @return array{
     *     deckId:string,
     *     resolvedCards:list<array{
     *         deckCardId:string,
     *         cardId:string,
     *         scryfallId:string,
     *         oracleId:string,
     *         name:string,
     *         imageUrl:?string,
     *         imageUris:array<string,mixed>,
     *         cardFaces:list<array<string,mixed>>,
     *         quantity:int,
     *         section:string,
     *         analysisProfile:array<string,mixed>
     *     }>,
     *     unmatchedCards:list<array{
     *         deckCardId:string,
     *         cardId:?string,
     *         name:?string,
     *         imageUrl:?string,
     *         quantity:int,
     *         section:string,
     *         reason:string
     *     }>
     * }
     */
    public function resolve(string $deckId): array
    {
        $resolvedCards = [];
        $unmatchedCards = [];

        foreach ($this->deckCardRows($deckId) as $row) {
            $deckCardId = (string) $row['deck_card_id'];
            $cardId = $this->stringOrNull($row['card_id'] ?? null);
            $name = $this->stringOrNull($row['card_name'] ?? null);
            $quantity = max(1, (int) ($row['quantity'] ?? 1));
            $section = $this->stringOrNull($row['section'] ?? null) ?? DeckCard::SECTION_MAIN;

            if (!in_array($section, DeckCard::SECTIONS, true)) {
                $unmatchedCards[] = $this->unmatchedCard($deckCardId, $cardId, $name, $this->imageUrl($row), $quantity, $section, 'unsupported_section');
                continue;
            }

            if ($cardId === null) {
                $unmatchedCards[] = $this->unmatchedCard($deckCardId, null, $name, null, $quantity, $section, 'missing_card');
                continue;
            }

            $oracleId = $this->stringOrNull($row['oracle_id'] ?? null);
            if ($oracleId === null) {
                $unmatchedCards[] = $this->unmatchedCard($deckCardId, $cardId, $name, $this->imageUrl($row), $quantity, $section, 'missing_oracle_id');
                continue;
            }

            if (!$this->boolValue($row['has_analysis_profile'] ?? false)) {
                $unmatchedCards[] = $this->unmatchedCard($deckCardId, $cardId, $name, $this->imageUrl($row), $quantity, $section, 'missing_analysis_profile');
                continue;
            }

            $resolvedCards[] = [
                'deckCardId' => $deckCardId,
                'cardId' => $cardId,
                'scryfallId' => (string) $row['scryfall_id'],
                'oracleId' => $oracleId,
                'name' => $name ?? 'Unknown card',
                'imageUrl' => $this->imageUrl($row),
                'imageUris' => $this->jsonObject($row['card_image_uris'] ?? null),
                'cardFaces' => $this->jsonList($row['card_faces'] ?? null),
                'quantity' => $quantity,
                'section' => $section,
                'analysisProfile' => $this->analysisProfile($row),
            ];
        }

        return [
            'deckId' => $deckId,
            'resolvedCards' => $resolvedCards,
            'unmatchedCards' => $unmatchedCards,
        ];
    }

    /**
     * @return iterable<array<string,mixed>>
     */
    private function deckCardRows(string $deckId): iterable
    {
        return $this->connection->executeQuery(
            <<<'SQL'
SELECT
    deck_card.id AS deck_card_id,
    deck_card.quantity,
    deck_card.section,
    card.id AS card_id,
    card.scryfall_id,
    card.name AS card_name,
    card.image_uris AS card_image_uris,
    card.card_faces,
    card.oracle_id,
    CASE WHEN card_analysis_profile.oracle_id IS NULL THEN false ELSE true END AS has_analysis_profile,
    card_analysis_profile.name AS profile_name,
    card_analysis_profile.mana_cost,
    card_analysis_profile.mana_value,
    card_analysis_profile.type_line,
    card_analysis_profile.colors,
    card_analysis_profile.color_identity,
    card_analysis_profile.produced_mana,
    card_analysis_profile.keywords,
    card_analysis_profile.commander_legal,
    card_analysis_profile.commander_banned,
    card_analysis_profile.can_be_commander,
    card_analysis_profile.is_land,
    card_analysis_profile.is_creature,
    card_analysis_profile.is_artifact,
    card_analysis_profile.is_enchantment,
    card_analysis_profile.is_instant,
    card_analysis_profile.is_sorcery,
    card_analysis_profile.is_planeswalker,
    card_analysis_profile.is_battle,
    card_analysis_profile.is_legendary,
    card_analysis_profile.edhrec_rank,
    card_analysis_profile.is_game_changer,
    card_analysis_profile.roles,
    card_analysis_profile.subroles,
    card_analysis_profile.role_scores,
    card_analysis_profile.condition_keys,
    card_analysis_profile.archetype_weights,
    card_analysis_profile.power_flags,
    card_analysis_profile.is_fast_mana,
    card_analysis_profile.is_free_interaction,
    card_analysis_profile.is_efficient_tutor,
    card_analysis_profile.is_cedh_staple,
    card_analysis_profile.analysis_hash
FROM deck_card
LEFT JOIN card ON card.id = deck_card.card_id
LEFT JOIN card_analysis_profile ON card_analysis_profile.oracle_id = card.oracle_id
WHERE deck_card.deck_id = :deck_id
  AND deck_card.section IN (:main_section, :commander_section)
ORDER BY deck_card.section, card.name, deck_card.id
SQL,
            [
                'deck_id' => $deckId,
                'main_section' => DeckCard::SECTION_MAIN,
                'commander_section' => DeckCard::SECTION_COMMANDER,
            ],
        )->iterateAssociative();
    }

    /**
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    private function analysisProfile(array $row): array
    {
        return [
            'name' => $this->stringOrNull($row['profile_name'] ?? null),
            'manaCost' => $this->stringOrNull($row['mana_cost'] ?? null),
            'manaValue' => $this->floatOrNull($row['mana_value'] ?? null),
            'typeLine' => $this->stringOrNull($row['type_line'] ?? null),
            'colors' => $this->jsonList($row['colors'] ?? null),
            'colorIdentity' => $this->jsonList($row['color_identity'] ?? null),
            'producedMana' => $this->jsonList($row['produced_mana'] ?? null),
            'keywords' => $this->jsonList($row['keywords'] ?? null),
            'commanderLegal' => $this->boolValue($row['commander_legal'] ?? false),
            'commanderBanned' => $this->boolValue($row['commander_banned'] ?? false),
            'canBeCommander' => $this->boolValue($row['can_be_commander'] ?? false),
            'types' => [
                'land' => $this->boolValue($row['is_land'] ?? false),
                'creature' => $this->boolValue($row['is_creature'] ?? false),
                'artifact' => $this->boolValue($row['is_artifact'] ?? false),
                'enchantment' => $this->boolValue($row['is_enchantment'] ?? false),
                'instant' => $this->boolValue($row['is_instant'] ?? false),
                'sorcery' => $this->boolValue($row['is_sorcery'] ?? false),
                'planeswalker' => $this->boolValue($row['is_planeswalker'] ?? false),
                'battle' => $this->boolValue($row['is_battle'] ?? false),
                'legendary' => $this->boolValue($row['is_legendary'] ?? false),
            ],
            'edhrecRank' => $this->intOrNull($row['edhrec_rank'] ?? null),
            'isGameChanger' => $this->boolValue($row['is_game_changer'] ?? false),
            'roles' => $this->jsonList($row['roles'] ?? null),
            'subroles' => $this->jsonList($row['subroles'] ?? null),
            'roleScores' => $this->jsonObject($row['role_scores'] ?? null),
            'conditionKeys' => $this->jsonList($row['condition_keys'] ?? null),
            'archetypeWeights' => $this->jsonObject($row['archetype_weights'] ?? null),
            'powerFlags' => $this->jsonList($row['power_flags'] ?? null),
            'flags' => [
                'fastMana' => $this->boolValue($row['is_fast_mana'] ?? false),
                'freeInteraction' => $this->boolValue($row['is_free_interaction'] ?? false),
                'efficientTutor' => $this->boolValue($row['is_efficient_tutor'] ?? false),
                'cedhStaple' => $this->boolValue($row['is_cedh_staple'] ?? false),
            ],
            'analysisHash' => $this->stringOrNull($row['analysis_hash'] ?? null),
        ];
    }

    /**
     * @return array{deckCardId:string,cardId:?string,name:?string,imageUrl:?string,quantity:int,section:string,reason:string}
     */
    private function unmatchedCard(string $deckCardId, ?string $cardId, ?string $name, ?string $imageUrl, int $quantity, string $section, string $reason): array
    {
        return [
            'deckCardId' => $deckCardId,
            'cardId' => $cardId,
            'name' => $name,
            'imageUrl' => $imageUrl,
            'quantity' => $quantity,
            'section' => $section,
            'reason' => $reason,
        ];
    }

    /**
     * @param array<string,mixed> $row
     */
    private function imageUrl(array $row): ?string
    {
        $imageUris = $this->jsonObject($row['card_image_uris'] ?? null);

        foreach (['normal', 'large', 'small', 'png', 'border_crop', 'art_crop'] as $key) {
            $url = $this->stringOrNull($imageUris[$key] ?? null);
            if ($url !== null) {
                return $url;
            }
        }

        return null;
    }

    private function stringOrNull(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $string = trim((string) $value);

        return $string !== '' ? $string : null;
    }

    private function intOrNull(mixed $value): ?int
    {
        return is_numeric($value) ? (int) $value : null;
    }

    private function floatOrNull(mixed $value): ?float
    {
        return is_numeric($value) ? (float) $value : null;
    }

    private function boolValue(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        if (is_int($value)) {
            return $value === 1;
        }

        if (!is_string($value)) {
            return false;
        }

        return in_array(mb_strtolower(trim($value)), ['1', 'true', 't', 'yes', 'y'], true);
    }

    /**
     * @return list<mixed>
     */
    private function jsonList(mixed $value): array
    {
        $decoded = $this->jsonValue($value);

        return is_array($decoded) ? array_values($decoded) : [];
    }

    /**
     * @return array<string,mixed>
     */
    private function jsonObject(mixed $value): array
    {
        $decoded = $this->jsonValue($value);

        return is_array($decoded) ? $decoded : [];
    }

    private function jsonValue(mixed $value): mixed
    {
        if (is_array($value)) {
            return $value;
        }

        if (!is_string($value) || trim($value) === '') {
            return null;
        }

        return json_decode($value, true);
    }
}
