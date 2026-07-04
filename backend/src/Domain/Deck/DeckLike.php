<?php

namespace App\Domain\Deck;

use App\Domain\User\User;
use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
#[ORM\Table(name: 'deck_like')]
#[ORM\UniqueConstraint(name: 'uniq_deck_like_deck_user', columns: ['deck_id', 'user_id'])]
#[ORM\Index(name: 'idx_deck_like_user', columns: ['user_id'])]
class DeckLike
{
    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: Deck::class)]
    #[ORM\JoinColumn(name: 'deck_id', referencedColumnName: 'id', nullable: false, onDelete: 'CASCADE')]
    private Deck $deck;

    #[ORM\Id]
    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'user_id', referencedColumnName: 'id', nullable: false, onDelete: 'CASCADE')]
    private User $user;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    public function __construct(Deck $deck, User $user)
    {
        $this->deck = $deck;
        $this->user = $user;
        $this->createdAt = new \DateTimeImmutable();
    }

    public function deck(): Deck
    {
        return $this->deck;
    }

    public function user(): User
    {
        return $this->user;
    }

    public function createdAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }
}
