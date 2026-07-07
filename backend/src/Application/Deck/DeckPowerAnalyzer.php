<?php

namespace App\Application\Deck;

final class DeckPowerAnalyzer
{
    /**
     * @param array{roles:array<string,int>,quality:array<string,array<string,int>>} $metrics
     * @param list<array{deckCardId:string,cardId:string,oracleId:string,name:string,imageUrl?:?string,quantity:int,section:string,analysisProfile:array<string,mixed>}> $resolvedCards
     * @param array<string,mixed> $combos
     * @return array{band:string,confidence:string,signals:array<string,int>,signalCards:array<string,list<array<string,mixed>>>,evidence:list<string>,notes:list<string>}
     */
    public function analyze(array $metrics, array $resolvedCards, array $combos): array
    {
        ['signals' => $signals, 'signalCards' => $signalCards] = $this->signals($resolvedCards, $combos);
        $score = 0;
        $evidence = [];

        $this->add($score, $evidence, min(36, $signals['completeWinLikeCombos'] * 18), $signals['completeWinLikeCombos'].' complete win-like combos');
        $this->add($score, $evidence, min(18, $signals['completeInfiniteCombos'] * 9), $signals['completeInfiniteCombos'].' complete infinite combos');
        $this->add($score, $evidence, min(16, $signals['compactWincons'] * 8), $signals['compactWincons'].' compact wincons');
        $this->add($score, $evidence, min(18, $signals['efficientTutors'] * 6), $signals['efficientTutors'].' efficient tutors');
        $this->add($score, $evidence, min(16, $signals['fastMana'] * 5), $signals['fastMana'].' fast mana cards');
        $this->add($score, $evidence, min(14, $signals['freeInteraction'] * 5), $signals['freeInteraction'].' free interaction cards');
        $this->add($score, $evidence, min(18, $signals['cedhStaples'] * 9), $signals['cedhStaples'].' cEDH staple flags');
        $this->add($score, $evidence, min(12, $signals['manaPositiveComboPieces'] * 6), $signals['manaPositiveComboPieces'].' mana-positive combo pieces');
        $this->add($score, $evidence, min(12, $signals['highPowerStaples'] * 6), $signals['highPowerStaples'].' high-power staple flags');
        $this->add($score, $evidence, min(10, $signals['gameChanger'] * 5), $signals['gameChanger'].' game changer/manual game changer cards');
        $this->add($score, $evidence, min(8, $signals['strongTutors'] * 3), $signals['strongTutors'].' strong tutor signals');
        $this->add($score, $evidence, min(8, $signals['strongProtection'] * 2), $signals['strongProtection'].' strong protection signals');
        $this->add($score, $evidence, min(4, $signals['lowOpportunityCost']), $signals['lowOpportunityCost'].' low opportunity cost cards as flexibility');

        if ($signals['lowOpportunityCost'] >= 8 && $this->rawPowerSignals($signals) === 0) {
            $score = min($score, 34);
            $evidence[] = 'low opportunity cost density alone did not raise the power band';
        }

        $band = $this->band($score, $signals);

        return [
            'band' => $band,
            'confidence' => $this->confidence($signals, $score),
            'signals' => $signals,
            'signalCards' => $signalCards,
            'evidence' => $evidence,
            'notes' => [
                'Low opportunity cost cards count as flexibility, not raw power.',
                'Power is a conservative band estimate, not a numeric level or match outcome prediction.',
            ],
        ];
    }

    /**
     * @param list<array{deckCardId:string,cardId:string,oracleId:string,name:string,imageUrl?:?string,quantity:int,section:string,analysisProfile:array<string,mixed>}> $resolvedCards
     * @param array<string,mixed> $combos
     * @return array{signals:array<string,int>,signalCards:array<string,list<array<string,mixed>>>}
     */
    private function signals(array $resolvedCards, array $combos): array
    {
        $signals = [
            'fastMana' => 0,
            'efficientTutors' => 0,
            'freeInteraction' => 0,
            'compactWincons' => 0,
            'completeWinLikeCombos' => (int) ($combos['winLikeCount'] ?? 0),
            'completeInfiniteCombos' => (int) (($combos['infiniteManaCount'] ?? 0) + ($combos['infiniteDamageCount'] ?? 0) + ($combos['infiniteTokensCount'] ?? 0)),
            'lowOpportunityCost' => 0,
            'cedhStaples' => 0,
            'manaPositiveComboPieces' => 0,
            'highPowerStaples' => 0,
            'gameChanger' => 0,
            'strongTutors' => 0,
            'strongProtection' => 0,
        ];
        $signalCards = array_fill_keys(array_keys($signals), []);

        foreach ($resolvedCards as $card) {
            $quantity = max(1, $card['quantity']);
            $profile = $card['analysisProfile'];
            $flags = $this->stringSet($profile['powerFlags'] ?? []);
            $reference = $this->cardReference($card);

            $this->addSignal($signals, $signalCards, 'fastMana', $quantity, $reference, $this->hasRole($profile, 'fast_mana') || $this->boolPath($profile, ['flags', 'fastMana']) || isset($flags['fast_mana']));
            $this->addSignal($signals, $signalCards, 'efficientTutors', $quantity, $reference, $this->boolPath($profile, ['flags', 'efficientTutor']) || isset($flags['efficient_tutor']));
            $this->addSignal($signals, $signalCards, 'freeInteraction', $quantity, $reference, $this->boolPath($profile, ['flags', 'freeInteraction']) || isset($flags['free_interaction']));
            $this->addSignal($signals, $signalCards, 'compactWincons', $quantity, $reference, isset($flags['compact_wincon']));
            $this->addSignal($signals, $signalCards, 'lowOpportunityCost', $quantity, $reference, isset($flags['low_opportunity_cost']));
            $this->addSignal($signals, $signalCards, 'cedhStaples', $quantity, $reference, $this->boolPath($profile, ['flags', 'cedhStaple']) || isset($flags['cedh_staple']));
            $this->addSignal($signals, $signalCards, 'manaPositiveComboPieces', $quantity, $reference, isset($flags['mana_positive_combo_piece']));
            $this->addSignal($signals, $signalCards, 'highPowerStaples', $quantity, $reference, isset($flags['high_power_staple']));
            $this->addSignal($signals, $signalCards, 'gameChanger', $quantity, $reference, ($profile['isGameChanger'] ?? false) === true || isset($flags['manual_game_changer']));
            $this->addSignal($signals, $signalCards, 'strongTutors', $quantity, $reference, $this->isStrongRole($profile, 'tutor'));
            $this->addSignal($signals, $signalCards, 'strongProtection', $quantity, $reference, $this->isStrongRole($profile, 'protection'));
        }

        foreach (($combos['complete'] ?? []) as $combo) {
            if (!is_array($combo)) {
                continue;
            }
            if (($combo['producesWinLike'] ?? false) === true) {
                $this->addComboSignalCards($signalCards, 'completeWinLikeCombos', $combo);
            }
            if (($combo['producesInfiniteMana'] ?? false) === true || ($combo['producesInfiniteDamage'] ?? false) === true || ($combo['producesInfiniteTokens'] ?? false) === true) {
                $this->addComboSignalCards($signalCards, 'completeInfiniteCombos', $combo);
            }
        }

        return ['signals' => $signals, 'signalCards' => $signalCards];
    }

    /**
     * @param array<string,int> $signals
     */
    private function band(int $score, array $signals): string
    {
        if ($signals['completeWinLikeCombos'] >= 2 && ($signals['efficientTutors'] + $signals['fastMana'] + $signals['freeInteraction'] + $signals['cedhStaples']) >= 8) {
            return 'cedh_like';
        }
        if ($score >= 78 && ($signals['completeWinLikeCombos'] > 0 || $signals['cedhStaples'] > 0)) {
            return 'cedh_like';
        }
        if ($score >= 62) {
            return 'high_power';
        }
        if ($score >= 45) {
            return 'high_casual';
        }
        if ($score >= 30) {
            return 'upgraded';
        }
        if ($score >= 14) {
            return 'casual';
        }

        return 'precon_like';
    }

    /**
     * @param array<string,int> $signals
     */
    private function confidence(array $signals, int $score): string
    {
        $strongSignals = $this->rawPowerSignals($signals);
        if ($strongSignals >= 6 || ($signals['completeWinLikeCombos'] > 0 && $strongSignals >= 3)) {
            return 'high';
        }
        if ($strongSignals >= 3 || $score >= 35) {
            return 'medium';
        }

        return 'low';
    }

    /**
     * @param array<string,int> $signals
     */
    private function rawPowerSignals(array $signals): int
    {
        return $signals['completeWinLikeCombos']
            + $signals['completeInfiniteCombos']
            + $signals['compactWincons']
            + $signals['efficientTutors']
            + $signals['fastMana']
            + $signals['freeInteraction']
            + $signals['cedhStaples']
            + $signals['manaPositiveComboPieces']
            + $signals['highPowerStaples'];
    }

    private function add(int &$score, array &$evidence, int $points, string $message): void
    {
        if ($points <= 0) {
            return;
        }
        $score += $points;
        $evidence[] = $message;
    }

    /**
     * @param array<string,int> $signals
     * @param array<string,list<array<string,mixed>>> $signalCards
     * @param array<string,mixed> $reference
     */
    private function addSignal(array &$signals, array &$signalCards, string $signal, int $quantity, array $reference, bool $matches): void
    {
        if (!$matches) {
            return;
        }

        $signals[$signal] += $quantity;
        $this->addSignalCard($signalCards, $signal, $reference);
    }

    /**
     * @param array<string,list<array<string,mixed>>> $signalCards
     * @param array<string,mixed> $combo
     */
    private function addComboSignalCards(array &$signalCards, string $signal, array $combo): void
    {
        foreach (($combo['cards'] ?? []) as $card) {
            if (is_array($card)) {
                $this->addSignalCard($signalCards, $signal, $card);
            }
        }
    }

    /**
     * @param array<string,list<array<string,mixed>>> $signalCards
     * @param array<string,mixed> $reference
     */
    private function addSignalCard(array &$signalCards, string $signal, array $reference): void
    {
        $signalCards[$signal] ??= [];
        $key = $this->cardReferenceKey($reference);
        if ($key === '') {
            return;
        }

        foreach ($signalCards[$signal] as $existing) {
            if ($this->cardReferenceKey($existing) === $key) {
                return;
            }
        }

        $signalCards[$signal][] = $reference;
    }

    /**
     * @param array<string,mixed> $card
     * @return array{deckCardId:string,cardId:string,oracleId:string,name:string,imageUrl:?string,quantity:int,section:string}
     */
    private function cardReference(array $card): array
    {
        return [
            'deckCardId' => (string) $card['deckCardId'],
            'cardId' => (string) $card['cardId'],
            'oracleId' => (string) $card['oracleId'],
            'name' => (string) $card['name'],
            'imageUrl' => $this->nullableString($card['imageUrl'] ?? null),
            'quantity' => max(1, (int) $card['quantity']),
            'section' => (string) $card['section'],
        ];
    }

    /**
     * @param array<string,mixed> $card
     */
    private function cardReferenceKey(array $card): string
    {
        foreach (['deckCardId', 'cardId', 'oracleId', 'name'] as $key) {
            $value = $card[$key] ?? null;
            if (is_scalar($value) && trim((string) $value) !== '') {
                return (string) $value;
            }
        }

        return '';
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function hasRole(array $profile, string $role): bool
    {
        return isset($this->stringSet($profile['roles'] ?? [])[$role]);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isStrongRole(array $profile, string $role): bool
    {
        $score = $this->roleScore($profile, $role);
        $quality = $this->stringValue($score['quality'] ?? null);

        return $quality === 'premium' || $quality === 'good';
    }

    /**
     * @param array<string,mixed> $profile
     * @return array<string,mixed>
     */
    private function roleScore(array $profile, string $role): array
    {
        $roleScores = $profile['roleScores'] ?? [];
        if (!is_array($roleScores) || !is_array($roleScores[$role] ?? null)) {
            return [];
        }

        return $roleScores[$role];
    }

    /**
     * @return array<string,true>
     */
    private function stringSet(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }

        $set = [];
        foreach ($value as $item) {
            if (!is_scalar($item)) {
                continue;
            }
            $string = mb_strtolower(trim((string) $item));
            if ($string !== '') {
                $set[$string] = true;
            }
        }

        return $set;
    }

    private function stringValue(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $string = mb_strtolower(trim((string) $value));

        return $string !== '' ? $string : null;
    }

    private function nullableString(mixed $value): ?string
    {
        return is_scalar($value) && trim((string) $value) !== '' ? (string) $value : null;
    }

    /**
     * @param array<string,mixed> $source
     * @param list<string> $path
     */
    private function boolPath(array $source, array $path): bool
    {
        $value = $source;
        foreach ($path as $segment) {
            if (!is_array($value) || !array_key_exists($segment, $value)) {
                return false;
            }
            $value = $value[$segment];
        }

        return $value === true;
    }
}
