<?php

namespace App\Application\Deck;

final class CardRoleMetricsAggregator
{
    private const COLORS = ['W', 'U', 'B', 'R', 'G'];

    private const TRUE_TUTOR_NAMES = [
        'demonic tutor',
        'vampiric tutor',
        'imperial seal',
        'gamble',
        'diabolic intent',
        'demonic consultation',
        'tainted pact',
    ];

    private const ROLE_METRICS = [
        'permanentRamp' => ['role' => 'ramp'],
        'fastMana' => ['role' => 'fast_mana'],
        'burstMana' => ['role' => 'burst_mana'],
        'rituals' => ['role' => 'ritual'],
        'manaFixing' => ['role' => 'mana_fixing'],
        'draw' => ['role' => 'draw'],
        'cardSelection' => ['role' => 'card_selection'],
        'spotRemoval' => ['role' => 'spot_removal'],
        'creatureRemoval' => ['role' => 'creature_removal'],
        'artifactRemoval' => ['role' => 'artifact_removal'],
        'enchantmentRemoval' => ['role' => 'enchantment_removal'],
        'counterspells' => ['role' => 'counterspell'],
        'protection' => ['role' => 'protection'],
        'graveyardHate' => ['role' => 'graveyard_hate'],
        'boardWipes' => ['role' => 'board_wipe'],
        'sacrificeOutlets' => ['role' => 'sacrifice_outlet'],
        'wincons' => ['role' => 'wincon'],
        'combatFinishers' => ['role' => 'combat_finisher'],
        'stax' => ['role' => 'stax'],
        'tax' => ['role' => 'tax'],
        'tokenMakers' => ['role' => 'token_maker'],
        'payoffs' => ['role' => 'payoff'],
        'enablers' => ['role' => 'enabler'],
        'comboPieces' => ['role' => 'combo_piece'],
        'recursion' => ['role' => 'recursion'],
        'reanimation' => ['role' => 'reanimation'],
        'costReducers' => ['role' => 'cost_reducer'],
        'discard' => ['role' => 'discard'],
        'lifegain' => ['role' => 'lifegain'],
    ];

    private const SUBROLE_METRICS = [
        'typedTutors' => 'typed_tutor',
        'landTutors' => 'land_tutor',
        'rampSearch' => 'ramp_search',
        'opponentTutors' => 'opponent_tutor',
        'massBounce' => 'mass_bounce',
        'pseudoWipes' => 'pseudo_wipe',
        'conditionalWipes' => 'conditional_wipe',
        'oneShotSacrifice' => 'one_shot_sacrifice',
        'selfSacrifice' => 'self_sacrifice',
        'sacrificePayoffs' => 'sacrifice_payoff',
        'combatSupport' => 'combat_support',
        'infectThreats' => 'infect_threat',
    ];

    /**
     * @param list<array{deckCardId:string,cardId:string,scryfallId:string,oracleId:string,name:string,imageUrl?:?string,imageUris?:array<string,mixed>,cardFaces?:list<array<string,mixed>>,quantity:int,section:string,analysisProfile:array<string,mixed>}> $resolvedCards
     * @param list<array{quantity:int}> $unmatchedCards
     * @return array{cards:array<string,int>,roles:array<string,int>,roleCards:array<string,list<array<string,mixed>>>,quality:array<string,array<string,int>>,qualityCards:array<string,array<string,list<array<string,mixed>>>>}
     */
    public function aggregate(array $resolvedCards, array $unmatchedCards): array
    {
        $roles = $this->emptyRoleMetrics();
        $roleCards = $this->emptyRoleCards();
        $quality = $this->emptyQualityMetrics();
        $qualityCards = $this->emptyQualityCards();
        $lands = 0;
        $resolvedQuantity = 0;
        $unmatchedQuantity = $this->totalQuantity($unmatchedCards);
        $identity = $this->deckColorIdentity($resolvedCards);

        foreach ($resolvedCards as $card) {
            $quantity = max(1, $card['quantity']);
            $resolvedQuantity += $quantity;
            $profile = $card['analysisProfile'];
            $manaProfile = is_array($card['manaProfile'] ?? null) ? $card['manaProfile'] : [];

            if ($this->isLand($profile, $manaProfile)) {
                $lands += $quantity;
                $this->addMetricCard($roleCards, 'lands', $this->cardReference($card));
            }

            $reference = $this->cardReference($card);
            $this->addRoleMetrics($roles, $roleCards, $profile, $manaProfile, $quantity, $reference);
            $this->addSubroleMetrics($roles, $roleCards, $profile, $manaProfile, $quantity, $reference);
            $this->addSpecialMetrics($roles, $roleCards, $profile, $manaProfile, $quantity, $reference);
            $this->addManaProfileMetrics($roles, $roleCards, $manaProfile, $quantity, $reference, $identity);
            $this->addQualityMetrics($quality, $qualityCards, $profile, $manaProfile, $quantity, $reference);
        }

        $roles['lands'] = $lands;

        return [
            'cards' => [
                'totalCards' => $resolvedQuantity + $unmatchedQuantity,
                'uniqueCards' => count($resolvedCards) + count($unmatchedCards),
                'resolvedCards' => $resolvedQuantity,
                'unmatchedCards' => $unmatchedQuantity,
                'lands' => $lands,
                'nonlands' => max(0, $resolvedQuantity - $lands),
            ],
            'roles' => $roles,
            'roleCards' => $roleCards,
            'quality' => $quality,
            'qualityCards' => $qualityCards,
        ];
    }

    /**
     * Projects the dedicated board-wipe read model into legacy role metrics.
     *
     * Backward compatibility note: roles.boardWipes is intentionally mapped to
     * hardCreatureWipes, not total board-wipe coverage. Artifact-only,
     * enchantment-only, graveyard-only, combat-only, bounce, and conditional
     * wipes remain available through their specific metrics.
     *
     * @param array<string,mixed> $metrics
     * @param array<string,mixed> $boardWipes
     * @return array<string,mixed>
     */
    public function withBoardWipeMetrics(array $metrics, array $boardWipes): array
    {
        if (!is_array($metrics['roles'] ?? null)) {
            return $metrics;
        }

        $roleMap = [
            'boardWipes' => 'hardCreatureWipes',
            'massBounce' => 'massBounce',
            'pseudoWipes' => 'pseudoTotal',
            'conditionalWipes' => 'conditionalWipes',
            'exileWipes' => 'exileWipes',
            'asymmetricalWipes' => 'asymmetricalWipes',
            'overloadedWipes' => 'overloadedWipes',
            'artifactWipes' => 'artifactWipes',
            'enchantmentWipes' => 'enchantmentWipes',
            'graveyardWipes' => 'graveyardWipes',
            'answersIndestructibleWipes' => 'answersIndestructible',
            'modalWipes' => 'modalWipes',
            'scalableWipes' => 'scalableWipes',
            'combatOnlyWipes' => 'combatOnlyWipes',
        ];

        foreach ($roleMap as $roleMetric => $boardWipeMetric) {
            $metrics['roles'][$roleMetric] = max(0, (int) ($boardWipes[$boardWipeMetric] ?? 0));
        }

        $details = is_array($boardWipes['details'] ?? null) ? $boardWipes['details'] : [];
        $roleCards = is_array($metrics['roleCards'] ?? null) ? $metrics['roleCards'] : [];
        foreach (array_keys($roleMap) as $roleMetric) {
            $roleCards[$roleMetric] = [];
        }

        foreach ($details as $detail) {
            if (!is_array($detail)) {
                continue;
            }
            $reference = $this->boardWipeDetailReference($detail);
            if ($reference === null) {
                continue;
            }

            foreach ($this->boardWipeDetailMetrics($detail) as $metric) {
                if (!array_key_exists($metric, $roleMap)) {
                    continue;
                }
                $this->addMetricCard($roleCards, $metric, $reference);
            }
        }

        $metrics['roleCards'] = $roleCards;

        return $metrics;
    }

    /**
     * @return array<string,int>
     */
    private function emptyRoleMetrics(): array
    {
        return array_fill_keys([
            'lands',
            'permanentRamp',
            'fastMana',
            'burstMana',
            'rituals',
            'manaFixing',
            'oneShotMana',
            'draw',
            'cardSelection',
            'trueTutors',
            'typedTutors',
            'landTutors',
            'rampSearch',
            'opponentTutors',
            'spotRemoval',
            'creatureRemoval',
            'artifactRemoval',
            'enchantmentRemoval',
            'counterspells',
            'protection',
            'graveyardHate',
            'boardWipes',
            'massBounce',
            'pseudoWipes',
            'conditionalWipes',
            'exileWipes',
            'asymmetricalWipes',
            'overloadedWipes',
            'artifactWipes',
            'enchantmentWipes',
            'graveyardWipes',
            'answersIndestructibleWipes',
            'modalWipes',
            'scalableWipes',
            'combatOnlyWipes',
            'sacrificeOutlets',
            'oneShotSacrifice',
            'selfSacrifice',
            'sacrificePayoffs',
            'wincons',
            'combatFinishers',
            'combatSupport',
            'infectThreats',
            'extraCombatEngines',
            'stax',
            'tax',
            'symmetricalStaxRisk',
            'tokenMakers',
            'payoffs',
            'enablers',
            'comboPieces',
            'recursion',
            'reanimation',
            'costReducers',
            'fetchlands',
            'colorFixing',
            'landRamp',
            'manaRocks',
            'manaDorks',
            'discard',
            'lifegain',
        ], 0);
    }

    /**
     * @return array<string,array<string,int>>
     */
    private function emptyQualityMetrics(): array
    {
        $empty = [
            'premium' => 0,
            'good' => 0,
            'medium' => 0,
            'slow' => 0,
            'oneShot' => 0,
        ];

        return [
            'ramp' => $empty,
            'tutor' => $empty,
            'wipe' => $empty,
            'protection' => $empty,
            'wincon' => $empty,
        ];
    }

    /**
     * @return array<string,array<string,list<array<string,mixed>>>>
     */
    private function emptyQualityCards(): array
    {
        $empty = [
            'premium' => [],
            'good' => [],
            'medium' => [],
            'slow' => [],
            'oneShot' => [],
        ];

        return [
            'ramp' => $empty,
            'tutor' => $empty,
            'wipe' => $empty,
            'protection' => $empty,
            'wincon' => $empty,
        ];
    }

    /**
     * @return array<string,list<array<string,mixed>>>
     */
    private function emptyRoleCards(): array
    {
        return array_fill_keys(array_keys($this->emptyRoleMetrics()), []);
    }

    /**
     * @param array<string,int> $roles
     * @param array<string,list<array<string,mixed>>> $roleCards
     * @param array<string,mixed> $profile
     * @param array<string,mixed> $reference
     */
    private function addRoleMetrics(array &$roles, array &$roleCards, array $profile, array $manaProfile, int $quantity, array $reference): void
    {
        foreach (self::ROLE_METRICS as $metric => $rule) {
            if (!$this->hasRole($profile, $rule['role'])) {
                continue;
            }

            if (in_array($metric, ['permanentRamp', 'fastMana', 'burstMana', 'rituals', 'manaFixing', 'costReducers'], true) && $manaProfile !== []) {
                continue;
            }

            if ($metric === 'permanentRamp' && $this->isOneShotRamp($profile, $manaProfile)) {
                continue;
            }

            if ($metric === 'sacrificeOutlets' && ($this->hasSubrole($profile, 'one_shot_sacrifice') || $this->hasSubrole($profile, 'self_sacrifice'))) {
                continue;
            }

            $roles[$metric] += $quantity;
            $this->addMetricCard($roleCards, $metric, $reference);
        }
    }

    /**
     * @param array<string,int> $roles
     * @param array<string,list<array<string,mixed>>> $roleCards
     * @param array<string,mixed> $profile
     * @param array<string,mixed> $reference
     */
    private function addSubroleMetrics(array &$roles, array &$roleCards, array $profile, array $manaProfile, int $quantity, array $reference): void
    {
        $isLand = $this->isLand($profile, $manaProfile);
        foreach (self::SUBROLE_METRICS as $metric => $subrole) {
            if ($isLand && in_array($metric, ['typedTutors', 'landTutors', 'rampSearch', 'opponentTutors'], true)) {
                continue;
            }

            if (in_array($metric, ['typedTutors', 'landTutors', 'rampSearch', 'opponentTutors'], true) && $this->manaProfileExcludesTrueTutor($manaProfile)) {
                continue;
            }

            if ($this->hasSubrole($profile, $subrole)) {
                $roles[$metric] += $quantity;
                $this->addMetricCard($roleCards, $metric, $reference);
            }
        }
    }

    /**
     * @param array<string,int> $roles
     * @param array<string,list<array<string,mixed>>> $roleCards
     * @param array<string,mixed> $profile
     * @param array<string,mixed> $reference
     */
    private function addSpecialMetrics(array &$roles, array &$roleCards, array $profile, array $manaProfile, int $quantity, array $reference): void
    {
        $isLand = $this->isLand($profile, $manaProfile);
        $isTrueTutor = $this->isTrueTutor($profile, $manaProfile, $reference);
        if (!$isLand && $isTrueTutor && $this->hasRole($profile, 'tutor') && !$this->hasAnySubrole($profile, ['true_tutor', 'typed_tutor', 'land_tutor', 'ramp_search', 'opponent_tutor'])) {
            $roles['trueTutors'] += $quantity;
            $this->addMetricCard($roleCards, 'trueTutors', $reference);
        }
        if (!$isLand && $isTrueTutor && $this->hasSubrole($profile, 'true_tutor')) {
            $roles['trueTutors'] += $quantity;
            $this->addMetricCard($roleCards, 'trueTutors', $reference);
        }
        if ($this->isOneShotRamp($profile, $manaProfile) && !$this->boolPath($manaProfile, ['isOneShotMana'])) {
            $roles['oneShotMana'] += $quantity;
            $this->addMetricCard($roleCards, 'oneShotMana', $reference);
        }
        if ($manaProfile === [] && ($this->boolPath($profile, ['flags', 'fastMana']) || $this->hasPowerFlag($profile, 'fast_mana'))) {
            if (!$this->hasRole($profile, 'fast_mana')) {
                $roles['fastMana'] += $quantity;
                $this->addMetricCard($roleCards, 'fastMana', $reference);
            }
        }
        if ($this->hasCondition($profile, 'symmetrical_stax_risk')) {
            $roles['symmetricalStaxRisk'] += $quantity;
            $this->addMetricCard($roleCards, 'symmetricalStaxRisk', $reference);
        }
        if ($this->hasRole($profile, 'extra_combat') || $this->hasSubrole($profile, 'extra_combat_engine')) {
            $roles['extraCombatEngines'] += $quantity;
            $this->addMetricCard($roleCards, 'extraCombatEngines', $reference);
        }
    }

    /**
     * @param array<string,int> $roles
     * @param array<string,list<array<string,mixed>>> $roleCards
     * @param array<string,mixed> $manaProfile
     * @param array<string,mixed> $reference
     */
    private function addManaProfileMetrics(array &$roles, array &$roleCards, array $manaProfile, int $quantity, array $reference, array $identity): void
    {
        if ($manaProfile === []) {
            return;
        }

        $fixesMultipleCommanderColors = $this->manaProfileFixesMultipleCommanderColors($manaProfile, $identity);
        foreach ([
            'fetchlands' => $this->boolPath($manaProfile, ['isFetchland']),
            'landTutors' => $this->isManaLandTutor($manaProfile),
            'rampSearch' => $this->isManaRampSearch($manaProfile),
            'landRamp' => !$this->boolPath($manaProfile, ['isFetchland']) && $this->boolPath($manaProfile, ['isLandRamp']),
            'manaRocks' => $this->boolPath($manaProfile, ['isManaRock']),
            'manaDorks' => $this->boolPath($manaProfile, ['isManaDork']),
            'fastMana' => $this->boolPath($manaProfile, ['isFastMana']),
            'burstMana' => $this->boolPath($manaProfile, ['isBurstMana']),
            'rituals' => $this->boolPath($manaProfile, ['isRitual']),
            'oneShotMana' => $this->boolPath($manaProfile, ['isOneShotMana']),
            'costReducers' => $this->boolPath($manaProfile, ['isCostReducer']),
            'colorFixing' => $fixesMultipleCommanderColors,
            'manaFixing' => $this->isManaFixing($manaProfile, $identity),
        ] as $metric => $matches) {
            if (!$matches) {
                continue;
            }
            $roles[$metric] += $quantity;
            $this->addMetricCard($roleCards, $metric, $reference);
        }

        if ($this->boolPath($manaProfile, ['isPermanentRamp'])
            && !$this->boolPath($manaProfile, ['isRitual'])
            && !$this->boolPath($manaProfile, ['isBurstMana'])
            && !$this->boolPath($manaProfile, ['isOneShotMana'])
            && !$this->boolPath($manaProfile, ['isCostReducer'])
        ) {
            $roles['permanentRamp'] += $quantity;
            $this->addMetricCard($roleCards, 'permanentRamp', $reference);
        }
    }

    /**
     * @param array<string,mixed> $detail
     * @return array<string,mixed>|null
     */
    private function boardWipeDetailReference(array $detail): ?array
    {
        $oracleId = $this->nullableString($detail['oracleId'] ?? null);
        $name = $this->nullableString($detail['name'] ?? null);
        if ($oracleId === null || $name === null) {
            return null;
        }

        return [
            'deckCardId' => $this->nullableString($detail['deckCardId'] ?? null) ?? $oracleId,
            'cardId' => $this->nullableString($detail['cardId'] ?? null) ?? $oracleId,
            'scryfallId' => $oracleId,
            'oracleId' => $oracleId,
            'name' => $name,
            'imageUrl' => $this->nullableString($detail['imageUrl'] ?? null),
            'imageUris' => [],
            'cardFaces' => [],
            'quantity' => max(1, (int) ($detail['quantity'] ?? 1)),
            'section' => 'main',
        ];
    }

    /**
     * @param array<string,mixed> $detail
     * @return list<string>
     */
    private function boardWipeDetailMetrics(array $detail): array
    {
        $metrics = [];
        $methods = $this->stringList($detail['methods'] ?? []);
        $scope = $this->stringList($detail['scope'] ?? []);
        $types = $this->stringList($detail['types'] ?? []);
        $symmetry = $this->stringValue($detail['symmetry'] ?? null);

        if (($detail['isHardWipe'] ?? false) === true && (in_array('creatures', $scope, true) || in_array('nonland_permanents', $scope, true) || in_array('all_permanents', $scope, true) || in_array('colored_permanents', $scope, true))) {
            $metrics[] = 'boardWipes';
        }
        if (in_array('mass_bounce', $types, true)) {
            $metrics[] = 'massBounce';
        }
        if (($detail['isPseudoWipe'] ?? false) === true) {
            $metrics[] = 'pseudoWipes';
        }
        if (in_array('conditional_wipe', $types, true)) {
            $metrics[] = 'conditionalWipes';
        }
        if (array_intersect($methods, ['exile', 'graveyard_exile']) !== []) {
            $metrics[] = 'exileWipes';
        }
        if (in_array($symmetry, ['asymmetrical', 'one_sided', 'opponents_only', 'semi_asymmetrical', 'controller_choice', 'each_player_chooses', 'creature_type_asymmetry'], true)) {
            $metrics[] = 'asymmetricalWipes';
        }
        if (($detail['isOverloaded'] ?? false) === true) {
            $metrics[] = 'overloadedWipes';
        }
        if (in_array('artifacts', $scope, true)) {
            $metrics[] = 'artifactWipes';
        }
        if (in_array('enchantments', $scope, true)) {
            $metrics[] = 'enchantmentWipes';
        }
        if (in_array('graveyards', $scope, true)) {
            $metrics[] = 'graveyardWipes';
        }
        if (($detail['answersIndestructible'] ?? false) === true) {
            $metrics[] = 'answersIndestructibleWipes';
        }
        if (($detail['isModal'] ?? false) === true) {
            $metrics[] = 'modalWipes';
        }
        if (($detail['isScalable'] ?? false) === true) {
            $metrics[] = 'scalableWipes';
        }
        if (in_array('combat_only_wipe', $types, true)) {
            $metrics[] = 'combatOnlyWipes';
        }

        return array_values(array_unique($metrics));
    }

    /**
     * @param array<string,mixed> $card
     * @return array{deckCardId:string,cardId:string,scryfallId:string,oracleId:string,name:string,imageUrl:?string,imageUris:array<string,mixed>,cardFaces:list<array<string,mixed>>,quantity:int,section:string}
     */
    private function cardReference(array $card): array
    {
        return [
            'deckCardId' => (string) $card['deckCardId'],
            'cardId' => (string) $card['cardId'],
            'scryfallId' => (string) $card['scryfallId'],
            'oracleId' => (string) $card['oracleId'],
            'name' => (string) $card['name'],
            'imageUrl' => $this->nullableString($card['imageUrl'] ?? null),
            'imageUris' => is_array($card['imageUris'] ?? null) ? $card['imageUris'] : [],
            'cardFaces' => is_array($card['cardFaces'] ?? null) ? array_values($card['cardFaces']) : [],
            'quantity' => max(1, (int) $card['quantity']),
            'section' => (string) $card['section'],
        ];
    }

    /**
     * @param array<string,list<array<string,mixed>>> $roleCards
     * @param array<string,mixed> $reference
     */
    private function addMetricCard(array &$roleCards, string $metric, array $reference): void
    {
        $roleCards[$metric] ??= [];
        $key = (string) ($reference['deckCardId'] ?? $reference['cardId'] ?? $reference['oracleId'] ?? '');
        foreach ($roleCards[$metric] as $existing) {
            $existingKey = (string) ($existing['deckCardId'] ?? $existing['cardId'] ?? $existing['oracleId'] ?? '');
            if ($existingKey === $key) {
                return;
            }
        }

        $roleCards[$metric][] = $reference;
    }

    /**
     * @param array<string,array<string,int>> $quality
     * @param array<string,array<string,list<array<string,mixed>>>> $qualityCards
     * @param array<string,mixed> $profile
     * @param array<string,mixed> $reference
     */
    private function addQualityMetrics(array &$quality, array &$qualityCards, array $profile, array $manaProfile, int $quantity, array $reference): void
    {
        foreach ([
            'ramp' => 'ramp',
            'tutor' => 'tutor',
            'wipe' => 'board_wipe',
            'protection' => 'protection',
            'wincon' => 'wincon',
        ] as $qualityKey => $role) {
            if ($qualityKey === 'tutor' && ($this->isLand($profile, $manaProfile) || $this->manaProfileExcludesTrueTutor($manaProfile))) {
                continue;
            }

            $roleScore = $this->roleScore($profile, $role);
            if ($roleScore === []) {
                continue;
            }

            $qualityValue = $this->stringValue($roleScore['quality'] ?? null);
            if ($qualityValue !== null && isset($quality[$qualityKey][$qualityValue])) {
                $quality[$qualityKey][$qualityValue] += $quantity;
                $this->addMetricCard($qualityCards[$qualityKey], $qualityValue, $reference);
            }

            if ($this->stringValue($roleScore['repeatability'] ?? null) === 'one_shot') {
                $quality[$qualityKey]['oneShot'] += $quantity;
                $this->addMetricCard($qualityCards[$qualityKey], 'oneShot', $reference);
            }
        }
    }

    /**
     * @param list<array{quantity:int}> $cards
     */
    private function totalQuantity(array $cards): int
    {
        return array_reduce(
            $cards,
            static fn (int $total, array $card): int => $total + max(1, $card['quantity']),
            0,
        );
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isLand(array $profile, array $manaProfile = []): bool
    {
        return $this->boolPath($manaProfile, ['isLand'])
            || $this->boolPath($profile, ['types', 'land'])
            || $this->hasRole($profile, 'land');
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function isOneShotRamp(array $profile, array $manaProfile = []): bool
    {
        $rampScore = $this->roleScore($profile, 'ramp');

        return $this->boolPath($manaProfile, ['isOneShotMana'])
            || $this->boolPath($manaProfile, ['isRitual'])
            || $this->boolPath($manaProfile, ['isBurstMana'])
            || $this->stringValue($rampScore['repeatability'] ?? null) === 'one_shot'
            || $this->hasRole($profile, 'burst_mana')
            || $this->hasRole($profile, 'ritual')
            || $this->hasSubrole($profile, 'one_shot_mana');
    }

    /**
     * @param array<string,mixed> $profile
     * @param array<string,mixed> $manaProfile
     * @param array<string,mixed> $reference
     */
    private function isTrueTutor(array $profile, array $manaProfile, array $reference): bool
    {
        if ($this->manaProfileExcludesTrueTutor($manaProfile) || $this->hasSubrole($profile, 'opponent_tutor')) {
            return false;
        }

        $name = $this->stringValue($reference['name'] ?? $profile['name'] ?? null);
        if ($name !== null && in_array($name, self::TRUE_TUTOR_NAMES, true)) {
            return true;
        }

        return $this->hasSubrole($profile, 'true_tutor')
            || ($this->hasRole($profile, 'tutor') && !$this->hasAnySubrole($profile, ['typed_tutor', 'land_tutor', 'ramp_search', 'opponent_tutor']));
    }

    /**
     * @param array<string,mixed> $manaProfile
     */
    private function manaProfileExcludesTrueTutor(array $manaProfile): bool
    {
        if ($manaProfile === []) {
            return false;
        }

        $category = $this->stringValue($manaProfile['manaSourceCategory'] ?? null);

        return $this->boolPath($manaProfile, ['isFetchland'])
            || $this->boolPath($manaProfile, ['isLand'])
            || $this->boolPath($manaProfile, ['isLandRamp'])
            || $this->boolPath($manaProfile, ['isLandTutor'])
            || $this->boolPath($manaProfile, ['isLandSearchToBattlefield'])
            || $this->boolPath($manaProfile, ['isLandSearchToHand'])
            || in_array($category, ['fetchland', 'land_ramp', 'ramp_search', 'land_tutor'], true);
    }

    /**
     * @param array<string,mixed> $manaProfile
     */
    private function isManaLandTutor(array $manaProfile): bool
    {
        return !$this->boolPath($manaProfile, ['isFetchland'])
            && ($this->boolPath($manaProfile, ['isLandTutor']) || $this->stringValue($manaProfile['manaSourceCategory'] ?? null) === 'land_tutor');
    }

    /**
     * @param array<string,mixed> $manaProfile
     */
    private function isManaRampSearch(array $manaProfile): bool
    {
        return !$this->boolPath($manaProfile, ['isFetchland'])
            && ($this->boolPath($manaProfile, ['isLandRamp'])
                || $this->boolPath($manaProfile, ['isLandSearchToBattlefield'])
                || in_array($this->stringValue($manaProfile['manaSourceCategory'] ?? null), ['land_ramp', 'ramp_search'], true));
    }

    /**
     * @param array<string,mixed> $manaProfile
     */
    private function isManaFixing(array $manaProfile, array $identity): bool
    {
        return $this->manaProfileFixesMultipleCommanderColors($manaProfile, $identity);
    }

    /**
     * @param list<array<string,mixed>> $cards
     * @return list<string>
     */
    private function deckColorIdentity(array $cards): array
    {
        $colors = [];
        foreach ($cards as $card) {
            $profile = is_array($card['analysisProfile'] ?? null) ? $card['analysisProfile'] : [];
            foreach ($this->stringList($profile['colorIdentity'] ?? []) as $color) {
                $symbol = strtoupper($color);
                if (in_array($symbol, self::COLORS, true)) {
                    $colors[$symbol] = true;
                }
            }
        }

        return array_keys($colors);
    }

    /**
     * @param array<string,mixed> $manaProfile
     * @param list<string> $identity
     */
    private function manaProfileFixesMultipleCommanderColors(array $manaProfile, array $identity): bool
    {
        if (count($identity) < 2) {
            return false;
        }

        $identityLookup = array_flip($identity);
        $covered = [];
        foreach ($this->manaProfileColors($manaProfile, $identity) as $color) {
            if (isset($identityLookup[$color])) {
                $covered[$color] = true;
            }
        }

        return count($covered) >= 2;
    }

    /**
     * @param array<string,mixed> $manaProfile
     * @param list<string> $identity
     * @return list<string>
     */
    private function manaProfileColors(array $manaProfile, array $identity): array
    {
        $colors = [];
        foreach ($this->stringList($manaProfile['producedManaColors'] ?? []) as $color) {
            $symbol = strtoupper($color);
            if (in_array($symbol, [...self::COLORS, 'C'], true)) {
                $colors[$symbol] = true;
            }
        }

        foreach ($this->stringList($manaProfile['fetchableLandTypes'] ?? []) as $type) {
            $symbol = $this->landTypeColor($type);
            if ($symbol !== null) {
                $colors[$symbol] = true;
            }
        }

        if ($this->boolPath($manaProfile, ['producesAnyColor'])) {
            foreach ($identity as $color) {
                $colors[$color] = true;
            }
        }

        return array_keys($colors);
    }

    private function landTypeColor(string $type): ?string
    {
        return match (mb_strtolower($type)) {
            'plains' => 'W',
            'island' => 'U',
            'swamp' => 'B',
            'mountain' => 'R',
            'forest' => 'G',
            default => null,
        };
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function hasRole(array $profile, string $role): bool
    {
        return in_array($role, $this->stringList($profile['roles'] ?? []), true);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function hasSubrole(array $profile, string $subrole): bool
    {
        return in_array($subrole, $this->stringList($profile['subroles'] ?? []), true);
    }

    /**
     * @param array<string,mixed> $profile
     * @param list<string> $subroles
     */
    private function hasAnySubrole(array $profile, array $subroles): bool
    {
        foreach ($subroles as $subrole) {
            if ($this->hasSubrole($profile, $subrole)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function hasPowerFlag(array $profile, string $flag): bool
    {
        return in_array($flag, $this->stringList($profile['powerFlags'] ?? []), true);
    }

    /**
     * @param array<string,mixed> $profile
     */
    private function hasCondition(array $profile, string $condition): bool
    {
        return in_array($condition, $this->stringList($profile['conditionKeys'] ?? []), true);
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

    /**
     * @return list<string>
     */
    private function stringList(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }

        return array_values(array_filter(
            array_map(fn (mixed $item): ?string => $this->stringValue($item), $value),
            static fn (?string $item): bool => $item !== null,
        ));
    }

    private function stringValue(mixed $value): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }

        $string = trim((string) $value);

        return $string !== '' ? mb_strtolower($string) : null;
    }

    private function nullableString(mixed $value): ?string
    {
        return is_scalar($value) && trim((string) $value) !== '' ? (string) $value : null;
    }
}
