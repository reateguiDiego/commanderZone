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

    #[ORM\Column(type: 'json')]
    private array $colors = [];

    #[ORM\Column(type: 'json')]
    private array $colorIdentity = [];

    #[ORM\Column(type: 'json')]
    private array $legalities = [];

    #[ORM\Column(type: 'json')]
    private array $imageUris = [];

    #[ORM\Column(type: 'string', length: 80)]
    private string $layout = 'normal';

    #[ORM\Column(type: 'boolean')]
    private bool $commanderLegal = false;

    #[ORM\Column(type: 'string', length: 16, nullable: true)]
    private ?string $setCode = null;

    #[ORM\Column(type: 'string', length: 32, nullable: true)]
    private ?string $collectorNumber = null;

    #[ORM\Column(type: 'string', length: 8, nullable: true)]
    private ?string $lang = null;

    #[ORM\Column(type: 'string', length: 255, nullable: true)]
    private ?string $printedName = null;

    #[ORM\Column(type: 'string', length: 255, nullable: true)]
    private ?string $flavorName = null;

    public function __construct(string $scryfallId)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->scryfallId = $scryfallId;
        $this->name = '';
        $this->normalizedName = '';
    }

    public static function normalizeName(string $name): string
    {
        return mb_strtolower(trim(preg_replace('/\s+/', ' ', $name) ?? $name));
    }

    public function updateFromScryfall(array $data): void
    {
        $this->name = (string) ($data['name'] ?? $this->name);
        $this->normalizedName = self::normalizeName($this->name);
        $this->manaCost = $data['mana_cost'] ?? null;
        $this->typeLine = $data['type_line'] ?? null;
        $this->oracleText = $data['oracle_text'] ?? null;
        $this->colors = $data['colors'] ?? [];
        $this->colorIdentity = $data['color_identity'] ?? [];
        $this->legalities = $data['legalities'] ?? [];
        $this->imageUris = $data['image_uris'] ?? ($data['card_faces'][0]['image_uris'] ?? []);
        $this->layout = $data['layout'] ?? 'normal';
        $this->commanderLegal = ($this->legalities['commander'] ?? null) === 'legal';
        $this->setCode = $data['set'] ?? null;
        $this->collectorNumber = $data['collector_number'] ?? null;
        $this->lang = $data['lang'] ?? null;
        $this->printedName = $data['printed_name'] ?? null;
        $this->flavorName = $data['flavor_name'] ?? null;
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

    public function imageUri(string $format): ?string
    {
        $uri = $this->imageUris[$format] ?? null;

        return is_string($uri) && $uri !== '' ? $uri : null;
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

    public function colorIdentity(): array
    {
        return $this->colorIdentity;
    }

    public function isCommanderLegal(): bool
    {
        return $this->commanderLegal;
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
            'name' => $this->name,
            'manaCost' => $this->manaCost,
            'typeLine' => $this->typeLine,
            'oracleText' => $this->oracleText,
            'colors' => $this->colors,
            'colorIdentity' => $this->colorIdentity,
            'legalities' => $this->legalities,
            'imageUris' => $this->imageUris,
            'layout' => $this->layout,
            'commanderLegal' => $this->commanderLegal,
            'set' => $this->setCode,
            'collectorNumber' => $this->collectorNumber,
            'lang' => $this->lang,
            'printedName' => $this->printedName,
            'flavorName' => $this->flavorName,
        ];
    }
}
