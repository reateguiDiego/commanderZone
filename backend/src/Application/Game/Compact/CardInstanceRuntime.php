<?php

namespace App\Application\Game\Compact;

final readonly class CardInstanceRuntime
{
    /**
     * @param array<string,mixed>|null $tokenMeta
     * @param array<string,int>        $counters
     * @param array{power:int|float|string|null,toughness:int|float|string|null,loyalty:int|float|string|null,defense:int|float|string|null,saga:int|float|string|null} $mutableStats
     * @param array<string,array<string,mixed>> $printedStats
     * @param array<string,array<string,mixed>> $manualOverrides
     * @param array<string,int|float|string>|null $position
     * @param list<string>             $visibleTo
     * @param array{x:float,y:float}|null $dungeonMarker
     */
    public function __construct(
        public string $instanceId,
        public string $cardKey,
        public string $ownerId,
        public string $controllerId,
        public string $zone,
        public bool $isCommander,
        public bool $isToken,
        public ?array $tokenMeta,
        public bool $tapped,
        public int $rotation,
        public array $counters,
        public array $mutableStats,
        public array $printedStats,
        public array $manualOverrides,
        public ?array $position,
        public bool $faceDown,
        public int $activeFace,
        public array $visibleTo,
        public int $visibleToMask = 0,
        public ?array $dungeonMarker = null,
    ) {
    }

    /**
     * @param array<string,mixed> $card
     */
    public static function fromLegacyCard(array $card, string $cardKey, string $ownerId, string $zone): self
    {
        $isToken = ($card['isToken'] ?? false) === true;
        $isTokenCopy = ($card['isTokenCopy'] ?? false) === true;
        $tokenMeta = is_array($card['tokenMeta'] ?? null) ? $card['tokenMeta'] : null;
        if ($isToken) {
            $tokenMeta ??= ['isCopy' => $isTokenCopy];
            if (!array_key_exists('isCopy', $tokenMeta)) {
                $tokenMeta['isCopy'] = $isTokenCopy;
            }
        }

        $printedStats = PowerToughnessModel::printedStats($card);
        $manualOverrides = PowerToughnessModel::manualOverrides($card, $printedStats);

        return new self(
            self::stringOrFallback($card['instanceId'] ?? null, ''),
            $cardKey,
            self::stringOrFallback($card['ownerId'] ?? null, $ownerId),
            self::stringOrFallback($card['controllerId'] ?? null, $ownerId),
            self::stringOrFallback($card['zone'] ?? null, $zone),
            ($card['isCommander'] ?? $zone === 'command') === true,
            $isToken,
            $isToken ? $tokenMeta : null,
            (bool) ($card['tapped'] ?? false),
            max(0, (int) ($card['rotation'] ?? 0)),
            is_array($card['counters'] ?? null) ? $card['counters'] : [],
            [
                'power' => self::stat($card['power'] ?? null),
                'toughness' => self::stat($card['toughness'] ?? null),
                'loyalty' => self::stat($card['loyalty'] ?? null),
                'defense' => self::stat($card['defense'] ?? null),
                'saga' => self::stat($card['saga'] ?? null),
            ],
            $printedStats,
            $manualOverrides,
            is_array($card['position'] ?? null) ? $card['position'] : null,
            (bool) ($card['faceDown'] ?? false),
            max(0, (int) ($card['activeFaceIndex'] ?? 0)),
            is_array($card['revealedTo'] ?? null) ? array_values($card['revealedTo']) : [],
            max(0, (int) ($card['visibleToMask'] ?? 0)),
            is_array($card['dungeonMarker'] ?? null) ? $card['dungeonMarker'] : null,
        );
    }

    /**
     * @return array<string,mixed>
     */
    public function toArray(): array
    {
        $runtime = [
            'instanceId' => $this->instanceId,
            'cardKey' => $this->cardKey,
            'ownerId' => $this->ownerId,
            'controllerId' => $this->controllerId,
            'zone' => $this->zone,
            'isCommander' => $this->isCommander,
            'isToken' => $this->isToken,
            'tokenMeta' => $this->tokenMeta,
            'tapped' => $this->tapped,
            'rotation' => $this->rotation,
            'counters' => $this->counters,
            'mutableStats' => $this->mutableStats,
            'printedStats' => $this->printedStats,
            'manualOverrides' => $this->manualOverrides,
            'faceDown' => $this->faceDown,
            'activeFace' => $this->activeFace,
            'visibleTo' => $this->visibleTo,
            'visibleToMask' => $this->visibleToMask,
        ];

        if ($this->position !== null) {
            $runtime['position'] = $this->position;
        }

        if ($this->dungeonMarker !== null) {
            $runtime['dungeonMarker'] = $this->dungeonMarker;
        }

        return $runtime;
    }

    private static function stringOrFallback(mixed $value, string $fallback): string
    {
        if (!is_string($value)) {
            return $fallback;
        }

        return trim($value) === '' ? $fallback : $value;
    }

    private static function stat(mixed $value): int|float|string|null
    {
        if ($value === null || $value === '') {
            return null;
        }

        return PowerToughnessModel::overrideValue($value);
    }
}
