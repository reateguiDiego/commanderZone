<?php

namespace App\Application\Game\Compact;

final readonly class CardStaticBundle
{
    /**
     * @param array<string,mixed>      $imageUris
     * @param list<array<string,mixed>> $cardFaces
     * @param list<string>             $colorIdentity
     * @param array{power:int|string|null,toughness:int|string|null,loyalty:int|string|null,defense:int|string|null} $baseStats
     * @param array<string,mixed>      $layoutMetadata
     */
    public function __construct(
        public string $cardKey,
        public string $cardVersion,
        public ?string $scryfallId,
        public string $name,
        public ?string $typeLine,
        public ?string $manaCost,
        public ?string $oracleText,
        public array $imageUris,
        public array $cardFaces,
        public array $colorIdentity,
        public array $baseStats,
        public array $layoutMetadata,
    ) {
    }

    /**
     * @param array<string,mixed> $card
     */
    public static function fromLegacyCard(array $card): self
    {
        $staticPayload = [
            'scryfallId' => self::nullableString($card['scryfallId'] ?? null),
            'name' => self::stringOrFallback($card['name'] ?? null, 'Unknown card'),
            'typeLine' => self::nullableString($card['typeLine'] ?? null),
            'manaCost' => self::nullableString($card['manaCost'] ?? null),
            'oracleText' => self::nullableString($card['oracleText'] ?? null),
            'imageUris' => is_array($card['imageUris'] ?? null) ? $card['imageUris'] : [],
            'cardFaces' => self::cardFaces($card['cardFaces'] ?? []),
            'colorIdentity' => self::colorIdentity($card['colorIdentity'] ?? []),
            'baseStats' => [
                'power' => self::stat($card['defaultPower'] ?? $card['power'] ?? null),
                'toughness' => self::stat($card['defaultToughness'] ?? $card['toughness'] ?? null),
                'loyalty' => self::stat($card['defaultLoyalty'] ?? $card['loyalty'] ?? null),
                'defense' => self::stat($card['defaultDefense'] ?? $card['defense'] ?? null),
            ],
            'layoutMetadata' => [
                'layout' => self::nullableString($card['layout'] ?? null),
                'hasRulings' => (bool) ($card['hasRulings'] ?? false),
            ],
        ];

        $cardVersion = substr(hash('sha256', json_encode($staticPayload, JSON_THROW_ON_ERROR)), 0, 16);
        $scryfallId = $staticPayload['scryfallId'];
        $cardKey = $scryfallId !== null && $scryfallId !== ''
            ? sprintf('scryfall:%s:%s', $scryfallId, $cardVersion)
            : sprintf('synthetic:%s', $cardVersion);

        return new self(
            $cardKey,
            $cardVersion,
            $scryfallId,
            $staticPayload['name'],
            $staticPayload['typeLine'],
            $staticPayload['manaCost'],
            $staticPayload['oracleText'],
            $staticPayload['imageUris'],
            $staticPayload['cardFaces'],
            $staticPayload['colorIdentity'],
            $staticPayload['baseStats'],
            $staticPayload['layoutMetadata'],
        );
    }

    /**
     * @param array<string,mixed> $data
     */
    public static function fromArray(array $data): self
    {
        return new self(
            self::stringOrFallback($data['cardKey'] ?? null, ''),
            self::stringOrFallback($data['cardVersion'] ?? null, ''),
            self::nullableString($data['scryfallId'] ?? null),
            self::stringOrFallback($data['name'] ?? null, 'Unknown card'),
            self::nullableString($data['typeLine'] ?? null),
            self::nullableString($data['manaCost'] ?? null),
            self::nullableString($data['oracleText'] ?? null),
            is_array($data['imageUris'] ?? null) ? $data['imageUris'] : [],
            self::cardFaces($data['cardFaces'] ?? []),
            self::colorIdentity($data['colorIdentity'] ?? []),
            [
                'power' => self::stat($data['baseStats']['power'] ?? null),
                'toughness' => self::stat($data['baseStats']['toughness'] ?? null),
                'loyalty' => self::stat($data['baseStats']['loyalty'] ?? null),
                'defense' => self::stat($data['baseStats']['defense'] ?? null),
            ],
            is_array($data['layoutMetadata'] ?? null) ? $data['layoutMetadata'] : [],
        );
    }

    /**
     * @return array<string,mixed>
     */
    public function toArray(): array
    {
        return [
            'cardKey' => $this->cardKey,
            'cardVersion' => $this->cardVersion,
            'scryfallId' => $this->scryfallId,
            'name' => $this->name,
            'typeLine' => $this->typeLine,
            'manaCost' => $this->manaCost,
            'oracleText' => $this->oracleText,
            'imageUris' => $this->imageUris,
            'cardFaces' => $this->cardFaces,
            'colorIdentity' => $this->colorIdentity,
            'baseStats' => $this->baseStats,
            'layoutMetadata' => $this->layoutMetadata,
        ];
    }

    /**
     * @return list<array<string,mixed>>
     */
    private static function cardFaces(mixed $faces): array
    {
        if (!is_array($faces)) {
            return [];
        }

        return array_values(array_filter($faces, static fn (mixed $face): bool => is_array($face)));
    }

    /**
     * @return list<string>
     */
    private static function colorIdentity(mixed $colors): array
    {
        if (!is_array($colors)) {
            return [];
        }

        return array_values(array_filter($colors, static fn (mixed $color): bool => is_string($color)));
    }

    private static function nullableString(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }

        $value = trim($value);

        return $value === '' ? null : $value;
    }

    private static function stringOrFallback(mixed $value, string $fallback): string
    {
        if (!is_string($value)) {
            return $fallback;
        }

        return trim($value) === '' ? $fallback : $value;
    }

    private static function stat(mixed $value): int|string|null
    {
        if ($value === null || $value === '') {
            return null;
        }

        return is_numeric($value) ? (int) $value : (string) $value;
    }
}
