<?php

namespace App\Domain\Deck;

use App\Domain\Card\Card;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'deck_card')]
class DeckCard
{
    public const SECTION_MAIN = 'main';
    public const SECTION_COMMANDER = 'commander';
    public const SECTION_SIDEBOARD = 'sideboard';
    public const SECTION_MAYBEBOARD = 'maybeboard';

    public const SECTIONS = [
        self::SECTION_MAIN,
        self::SECTION_COMMANDER,
        self::SECTION_SIDEBOARD,
        self::SECTION_MAYBEBOARD,
    ];

    public const PLAYABLE_SECTIONS = [
        self::SECTION_MAIN,
        self::SECTION_COMMANDER,
    ];

    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: Deck::class, inversedBy: 'cards')]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private Deck $deck;

    #[ORM\ManyToOne(targetEntity: Card::class)]
    #[ORM\JoinColumn(nullable: false)]
    private Card $card;

    #[ORM\Column(type: 'integer')]
    private int $quantity;

    #[ORM\Column(type: 'string', length: 32)]
    private string $section;

    public function __construct(Deck $deck, Card $card, int $quantity, string $section = self::SECTION_MAIN)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->deck = $deck;
        $this->card = $card;
        $this->quantity = max(1, $quantity);
        $this->moveToSection($section);
    }

    public function card(): Card
    {
        return $this->card;
    }

    public function id(): string
    {
        return $this->id;
    }

    public function quantity(): int
    {
        return $this->quantity;
    }

    public function section(): string
    {
        return $this->section;
    }

    public function changeQuantity(int $quantity): void
    {
        $this->quantity = max(1, $quantity);
    }

    public function moveToSection(string $section): void
    {
        if (!in_array($section, self::SECTIONS, true)) {
            throw new \InvalidArgumentException('Invalid deck card section.');
        }

        $this->section = $section;
    }

    public function isPlayable(): bool
    {
        return in_array($this->section, self::PLAYABLE_SECTIONS, true);
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'quantity' => $this->quantity,
            'section' => $this->section,
            'card' => $this->card->toArray(),
        ];
    }
}
