<?php

namespace App\Domain\Card;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'card')]
#[ORM\UniqueConstraint(name: 'uniq_card_scryfall_id', columns: ['scryfall_id'])]
#[ORM\Index(name: 'idx_card_normalized_name', columns: ['normalized_name'])]
#[ORM\Index(name: 'idx_card_print', columns: ['set_code', 'collector_number'])]
class Card
{
    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\Column(type: 'string', length: 36)]
    private string $scryfallId;

    #[ORM\Column(type: 'string', length: 255)]
    private string $name;

    #[ORM\Column(type: 'string', length: 255)]
    private string $normalizedName;

    #[ORM\Column(type: 'string', length: 255, nullable: true)]
    private ?string $manaCost = null;

    #[ORM\Column(type: 'text', nullable: true)]
    private ?string $typeLine = null;

    #[ORM\Column(type: 'text', nullable: true)]
    private ?string $oracleText = null;

    #[ORM\Column(type: 'string', length: 16, nullable: true)]
    private ?string $power = null;

    #[ORM\Column(type: 'string', length: 16, nullable: true)]
    private ?string $toughness = null;

    #[ORM\Column(type: 'string', length: 16, nullable: true)]
    private ?string $loyalty = null;

    #[ORM\Column(type: 'json')]
    private array $faceStats = [];

    #[ORM\Column(type: 'json')]
    private array $colors = [];

    #[ORM\Column(type: 'json')]
    private array $colorIdentity = [];

    #[ORM\Column(type: 'json')]
    private array $legalities = [];

    #[ORM\Column(type: 'json')]
    private array $imageUris = [];

    #[ORM\Column(type: 'json')]
    private array $cardFaces = [];

    #[ORM\Column(type: 'json')]
    private array $allParts = [];

    #[ORM\Column(type: 'float', nullable: true)]
    private ?float $manaValue = null;

    #[ORM\Column(type: 'json')]
    private array $producedMana = [];

    #[ORM\Column(type: 'json')]
    private array $prices = [];

    #[ORM\Column(type: 'string', length: 80)]
    private string $layout = 'normal';

    #[ORM\Column(type: 'boolean')]
    private bool $commanderLegal = false;

    #[ORM\Column(type: 'string', length: 16, nullable: true)]
    private ?string $setCode = null;

    #[ORM\Column(type: 'string', length: 255, nullable: true)]
    private ?string $setName = null;

    #[ORM\Column(type: 'string', length: 24, nullable: true)]
    private ?string $rarity = null;

    #[ORM\Column(type: 'string', length: 32, nullable: true)]
    private ?string $collectorNumber = null;

    #[ORM\Column(type: 'string', length: 8, nullable: true)]
    private ?string $lang = null;

    #[ORM\Column(type: 'string', length: 255, nullable: true)]
    private ?string $printedName = null;

    #[ORM\Column(type: 'string', length: 255, nullable: true)]
    private ?string $flavorName = null;

    #[ORM\Column(type: 'string', length: 32, nullable: true)]
    private ?string $imageStatus = null;

    #[ORM\Column(type: 'boolean')]
    private bool $hasRulings = false;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $updatedAt;

    public function __construct(string $scryfallId)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->scryfallId = $scryfallId;
        $this->name = '';
        $this->normalizedName = '';
        $this->updatedAt = new \DateTimeImmutable();
        $this->faceStats = $this->defaultFaceStats();
    }

    public static function normalizeName(string $name): string
    {
        return mb_strtolower(trim(preg_replace('/\s+/', ' ', $name) ?? $name));
    }

    public function updateFromScryfall(array $data): void
    {
        $this->name = (string) ($data['name'] ?? $this->name);
        $this->normalizedName = self::normalizeName($this->name);
        $this->manaCost = $this->cardString($data, 'mana_cost');
        $this->typeLine = $this->cardString($data, 'type_line');
        $this->oracleText = $this->oracleTextFromScryfall($data);
        $this->power = $this->cardString($data, 'power');
        $this->toughness = $this->cardString($data, 'toughness');
        $this->loyalty = $this->cardString($data, 'loyalty');
        $this->faceStats = $this->faceStatsFromScryfall($data);
        $this->colors = $data['colors'] ?? [];
        $this->colorIdentity = $data['color_identity'] ?? [];
        $this->legalities = $data['legalities'] ?? [];
        $this->imageUris = $data['image_uris'] ?? ($data['card_faces'][0]['image_uris'] ?? []);
        $this->cardFaces = $this->rawCardFaces($data);
        $this->allParts = $data['all_parts'] ?? [];
        $this->manaValue = isset($data['cmc']) ? (float) $data['cmc'] : null;
        $this->producedMana = $data['produced_mana'] ?? [];
        $this->prices = $data['prices'] ?? [];
        $this->layout = $data['layout'] ?? 'normal';
        $this->commanderLegal = ($this->legalities['commander'] ?? null) === 'legal';
        $this->setCode = $data['set'] ?? null;
        $this->setName = $this->cardString($data, 'set_name');
        $this->rarity = $this->cardString($data, 'rarity');
        $this->collectorNumber = $data['collector_number'] ?? null;
        $this->lang = $data['lang'] ?? null;
        $this->printedName = $data['printed_name'] ?? null;
        $this->flavorName = $data['flavor_name'] ?? null;
        $this->imageStatus = isset($data['image_status']) && is_scalar($data['image_status']) && (string) $data['image_status'] !== ''
            ? (string) $data['image_status']
            : null;
        if (array_key_exists('has_rulings', $data)) {
            $this->hasRulings = (bool) $data['has_rulings'];
        }
        $this->touch();
    }

    public function id(): string
    {
        return $this->id;
    }

    public function scryfallId(): string
    {
        return $this->scryfallId;
    }

    public function name(): string
    {
        return $this->name;
    }

    public function normalizedName(): string
    {
        return $this->normalizedName;
    }

    public function typeLine(): ?string
    {
        return $this->typeLine;
    }

    public function manaCost(): ?string
    {
        return $this->manaCost;
    }

    public function oracleText(): ?string
    {
        return $this->oracleText;
    }

    public function power(): ?string
    {
        return $this->power;
    }

    public function toughness(): ?string
    {
        return $this->toughness;
    }

    public function loyalty(): ?string
    {
        return $this->loyalty;
    }

    public function legalities(): array
    {
        return $this->legalities;
    }

    public function faceStats(): array
    {
        return $this->normalizeFaceStats($this->faceStats);
    }

    public function layout(): string
    {
        return $this->layout;
    }

    public function imageUri(string $format): ?string
    {
        $uri = $this->imageUris[$format] ?? null;

        return is_string($uri) && $uri !== '' ? $uri : null;
    }

    public function imageUris(): array
    {
        return $this->imageUris;
    }

    public function cardFaces(): array
    {
        return array_values(array_map(fn (array $face): array => $this->normalizeCardFace($face), $this->cardFaces));
    }

    public function allParts(): array
    {
        return $this->allParts;
    }

    public function manaValue(): ?float
    {
        return $this->manaValue;
    }

    public function producedMana(): array
    {
        return $this->producedMana;
    }

    public function prices(): array
    {
        return $this->prices;
    }

    public function priceEur(): ?float
    {
        $price = $this->prices['eur'] ?? null;

        return is_numeric($price) ? (float) $price : null;
    }

    public function setCode(): ?string
    {
        return $this->setCode;
    }

    public function collectorNumber(): ?string
    {
        return $this->collectorNumber;
    }

    public function flavorName(): ?string
    {
        return $this->flavorName;
    }

    public function imageStatus(): ?string
    {
        return $this->imageStatus;
    }

    public function lang(): ?string
    {
        return $this->lang;
    }

    public function hasRulings(): bool
    {
        return $this->hasRulings;
    }

    public function printedName(): ?string
    {
        return $this->printedName;
    }

    public function colorIdentity(): array
    {
        return $this->colorIdentity;
    }

    public function isCommanderLegal(): bool
    {
        return $this->commanderLegal;
    }

    public function setName(): ?string
    {
        return $this->setName;
    }

    public function rarity(): ?string
    {
        return $this->rarity;
    }

    public function legalityInFormat(string $format): ?string
    {
        $value = $this->legalities[$format] ?? null;

        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }

    public function isLegalInFormat(string $format): bool
    {
        if ($format === 'commander') {
            return $this->commanderLegal;
        }

        return $this->legalityInFormat($format) === 'legal';
    }

    public function isBasicLand(): bool
    {
        return str_contains($this->typeLine ?? '', 'Basic');
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'scryfallId' => $this->scryfallId,
            'name' => $this->displayName(),
            'manaCost' => $this->manaCost,
            'typeLine' => $this->typeLine,
            'oracleText' => $this->oracleText,
            'power' => $this->power,
            'toughness' => $this->toughness,
            'loyalty' => $this->loyalty,
            'faceStats' => $this->faceStats(),
            'colors' => $this->colors,
            'colorIdentity' => $this->colorIdentity,
            'legalities' => $this->legalities,
            'imageUris' => $this->imageUris,
            'cardFaces' => $this->cardFaces(),
            'hasRulings' => $this->hasRulings,
            'allParts' => $this->allParts,
            'manaValue' => $this->manaValue,
            'producedMana' => $this->producedMana,
            'prices' => $this->prices,
            'layout' => $this->layout,
            'commanderLegal' => $this->commanderLegal,
            'set' => $this->setCode,
            'setName' => $this->setName,
            'rarity' => $this->rarity,
            'collectorNumber' => $this->collectorNumber,
            'lang' => $this->lang,
            'printedName' => $this->printedName,
            'flavorName' => $this->flavorName,
        ];
    }

    private function displayName(): string
    {
        $printedName = trim((string) $this->printedName);

        return $printedName !== '' ? $printedName : $this->name;
    }

    private function cardString(array $data, string $key): ?string
    {
        $value = $data[$key] ?? $this->firstFaceValue($data, $key);

        return is_scalar($value) && (string) $value !== '' ? (string) $value : null;
    }

    private function firstFaceValue(array $data, string $key): mixed
    {
        $face = $data['card_faces'][0] ?? null;

        return is_array($face) ? ($face[$key] ?? null) : null;
    }

    private function rawCardFaces(array $data): array
    {
        $faces = $data['card_faces'] ?? [];
        if (!is_array($faces)) {
            return [];
        }

        return array_values(array_filter($faces, static fn (mixed $face): bool => is_array($face)));
    }

    private function normalizeCardFace(array $face): array
    {
        return [
            'name' => isset($face['name']) && is_scalar($face['name']) ? (string) $face['name'] : null,
            'manaCost' => isset($face['mana_cost']) && is_scalar($face['mana_cost']) ? (string) $face['mana_cost'] : null,
            'typeLine' => isset($face['type_line']) && is_scalar($face['type_line']) ? (string) $face['type_line'] : null,
            'oracleText' => isset($face['oracle_text']) && is_scalar($face['oracle_text']) ? (string) $face['oracle_text'] : null,
            'power' => isset($face['power']) && is_scalar($face['power']) ? (string) $face['power'] : null,
            'toughness' => isset($face['toughness']) && is_scalar($face['toughness']) ? (string) $face['toughness'] : null,
            'loyalty' => isset($face['loyalty']) && is_scalar($face['loyalty']) ? (string) $face['loyalty'] : null,
            'defense' => isset($face['defense']) && is_scalar($face['defense']) ? (string) $face['defense'] : null,
            'handModifier' => isset($face['hand_modifier']) && is_scalar($face['hand_modifier']) ? (string) $face['hand_modifier'] : null,
            'lifeModifier' => isset($face['life_modifier']) && is_scalar($face['life_modifier']) ? (string) $face['life_modifier'] : null,
            'colors' => is_array($face['colors'] ?? null) ? array_values($face['colors']) : [],
            'imageUris' => is_array($face['image_uris'] ?? null) ? $face['image_uris'] : [],
        ];
    }

    private function oracleTextFromScryfall(array $data): ?string
    {
        if (isset($data['oracle_text']) && is_scalar($data['oracle_text']) && (string) $data['oracle_text'] !== '') {
            return (string) $data['oracle_text'];
        }

        $faces = $data['card_faces'] ?? null;
        if (!is_array($faces)) {
            return null;
        }

        $texts = [];
        foreach ($faces as $face) {
            if (!is_array($face) || !isset($face['oracle_text']) || !is_scalar($face['oracle_text'])) {
                continue;
            }

            $text = trim((string) $face['oracle_text']);
            if ($text !== '') {
                $texts[] = $text;
            }
        }

        return $texts === [] ? null : implode("\n//\n", $texts);
    }

    private function touch(): void
    {
        $this->updatedAt = new \DateTimeImmutable();
    }

    private function faceStatsFromScryfall(array $data): array
    {
        $faces = [];
        foreach ($this->rawCardFaces($data) as $face) {
            $faces[] = [
                'name' => isset($face['name']) && is_scalar($face['name']) ? (string) $face['name'] : null,
                ...$this->statBlock([
                    'power' => $face['power'] ?? null,
                    'toughness' => $face['toughness'] ?? null,
                    'loyalty' => $face['loyalty'] ?? null,
                    'defense' => $face['defense'] ?? null,
                    'handModifier' => $face['hand_modifier'] ?? null,
                    'lifeModifier' => $face['life_modifier'] ?? null,
                ]),
            ];
        }

        return [
            'root' => $this->statBlock([
                'power' => $this->cardString($data, 'power'),
                'toughness' => $this->cardString($data, 'toughness'),
                'loyalty' => $this->cardString($data, 'loyalty'),
                'defense' => $this->cardString($data, 'defense'),
                'handModifier' => $this->cardString($data, 'hand_modifier'),
                'lifeModifier' => $this->cardString($data, 'life_modifier'),
            ]),
            'faces' => $faces,
        ];
    }

    private function defaultFaceStats(): array
    {
        return [
            'root' => $this->statBlock([]),
            'faces' => [],
        ];
    }

    private function normalizeFaceStats(array $faceStats): array
    {
        $root = is_array($faceStats['root'] ?? null) ? $faceStats['root'] : [];
        $faces = $faceStats['faces'] ?? [];

        if (!is_array($faces)) {
            $faces = [];
        }

        return [
            'root' => $this->statBlock($root),
            'faces' => array_values(array_map(function (mixed $face): array {
                if (!is_array($face)) {
                    return [
                        'name' => null,
                        ...$this->statBlock([]),
                    ];
                }

                return [
                    'name' => isset($face['name']) && is_scalar($face['name']) ? (string) $face['name'] : null,
                    ...$this->statBlock($face),
                ];
            }, $faces)),
        ];
    }

    /**
     * @param array<string,mixed> $values
     *
     * @return array{power:?string,toughness:?string,loyalty:?string,defense:?string,handModifier:?string,lifeModifier:?string}
     */
    private function statBlock(array $values): array
    {
        return [
            'power' => $this->scalarOrNull($values['power'] ?? null),
            'toughness' => $this->scalarOrNull($values['toughness'] ?? null),
            'loyalty' => $this->scalarOrNull($values['loyalty'] ?? null),
            'defense' => $this->scalarOrNull($values['defense'] ?? null),
            'handModifier' => $this->scalarOrNull($values['handModifier'] ?? null),
            'lifeModifier' => $this->scalarOrNull($values['lifeModifier'] ?? null),
        ];
    }

    private function scalarOrNull(mixed $value): ?string
    {
        return is_scalar($value) && (string) $value !== '' ? (string) $value : null;
    }

}
