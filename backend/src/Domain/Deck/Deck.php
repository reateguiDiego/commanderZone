<?php

namespace App\Domain\Deck;

use App\Domain\User\User;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'deck')]
class Deck
{
    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private User $owner;

    #[ORM\Column(type: 'string', length: 120)]
    private string $name;

    #[ORM\Column(type: 'string', length: 40)]
    private string $format = 'commander';

    #[ORM\ManyToOne(targetEntity: DeckFolder::class)]
    #[ORM\JoinColumn(nullable: true, onDelete: 'SET NULL')]
    private ?DeckFolder $folder = null;

    #[ORM\OneToMany(mappedBy: 'deck', targetEntity: DeckCard::class, cascade: ['persist', 'remove'], orphanRemoval: true)]
    private Collection $cards;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $updatedAt;

    public function __construct(User $owner, string $name)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->owner = $owner;
        $this->name = trim($name);
        $this->cards = new ArrayCollection();
        $this->createdAt = new \DateTimeImmutable();
        $this->updatedAt = $this->createdAt;
    }

    public function id(): string
    {
        return $this->id;
    }

    public function owner(): User
    {
        return $this->owner;
    }

    public function name(): string
    {
        return $this->name;
    }

    public function rename(string $name): void
    {
        $this->name = trim($name);
        $this->touch();
    }

    public function folder(): ?DeckFolder
    {
        return $this->folder;
    }

    public function moveToFolder(?DeckFolder $folder): void
    {
        $this->folder = $folder;
        $this->touch();
    }

    public function clearCards(): void
    {
        $this->cards->clear();
        $this->touch();
    }

    public function addCard(DeckCard $card): void
    {
        $this->cards->add($card);
        $this->touch();
    }

    public function addOrIncrementCard(\App\Domain\Card\Card $card, int $quantity, string $section): DeckCard
    {
        foreach ($this->cards as $deckCard) {
            if (!$deckCard instanceof DeckCard) {
                continue;
            }

            if ($deckCard->card()->scryfallId() === $card->scryfallId() && $deckCard->section() === $section) {
                $deckCard->changeQuantity($deckCard->quantity() + $quantity);
                $this->touch();

                return $deckCard;
            }
        }

        $deckCard = new DeckCard($this, $card, $quantity, $section);
        $this->addCard($deckCard);

        return $deckCard;
    }

    public function removeCard(DeckCard $card): void
    {
        $this->cards->removeElement($card);
        $this->touch();
    }

    public function cards(): Collection
    {
        return $this->cards;
    }

    public function touch(): void
    {
        $this->updatedAt = new \DateTimeImmutable();
    }

    public function toArray(bool $withCards = false): array
    {
        $data = [
            'id' => $this->id,
            'name' => $this->name,
            'format' => $this->format,
            'folderId' => $this->folder?->id(),
        ];

        if ($withCards) {
            $data['cards'] = array_map(static fn (DeckCard $card) => $card->toArray(), $this->cards->toArray());
        }

        return $data;
    }
}
