<?php

namespace App\Domain\Deck;

use App\Application\Deck\DeckFormatCatalog;
use App\Domain\Card\Card;
use App\Domain\User\User;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'deck')]
#[ORM\UniqueConstraint(name: 'uniq_deck_slug', columns: ['slug'])]
#[ORM\UniqueConstraint(name: 'uniq_deck_public_slug', columns: ['public_slug'])]
#[ORM\Index(name: 'idx_deck_visibility_valid_updated_at', columns: ['visibility', 'is_valid', 'updated_at'])]
class Deck
{
    public const VISIBILITY_PRIVATE = 'private';
    public const VISIBILITY_PUBLIC = 'public';
    public const DEFAULT_BACKGROUND_NAME = 'back_5';
    public const DEFAULT_SLEEVES_NAME = 'facedown_card';

    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(nullable: false, onDelete: 'CASCADE')]
    private User $owner;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'creator_user_id', nullable: false, onDelete: 'CASCADE')]
    private User $creatorUser;

    #[ORM\Column(type: 'string', length: 120)]
    private string $name;

    #[ORM\Column(type: 'string', length: 40)]
    private string $format = DeckFormatCatalog::COMMANDER;

    #[ORM\Column(type: 'string', length: 20)]
    private string $visibility = self::VISIBILITY_PRIVATE;

    #[ORM\Column(type: 'string', length: 220, nullable: true)]
    private ?string $slug = null;

    #[ORM\Column(type: 'string', length: 220, nullable: true)]
    private ?string $publicSlug = null;

    #[ORM\Column(name: 'is_valid', type: 'boolean', options: ['default' => false])]
    private bool $valid = false;

    #[ORM\Column(type: 'string', length: 80)]
    private string $backgroundName = self::DEFAULT_BACKGROUND_NAME;

    #[ORM\Column(type: 'string', length: 80)]
    private string $sleevesName = self::DEFAULT_SLEEVES_NAME;

    #[ORM\Column(type: 'integer', options: ['default' => 0])]
    private int $likes = 0;

    #[ORM\Column(type: 'integer', options: ['default' => 0])]
    private int $copies = 0;

    #[ORM\ManyToOne(targetEntity: DeckFolder::class)]
    #[ORM\JoinColumn(nullable: true, onDelete: 'SET NULL')]
    private ?DeckFolder $folder = null;

    #[ORM\OneToMany(mappedBy: 'deck', targetEntity: DeckCard::class, cascade: ['persist', 'remove'], orphanRemoval: true)]
    private Collection $cards;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $updatedAt;

    public function __construct(User $owner, string $name, ?User $creatorUser = null)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->owner = $owner;
        $this->creatorUser = $creatorUser ?? $owner;
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

    public function creatorUser(): User
    {
        return $this->creatorUser;
    }

    public function name(): string
    {
        return $this->name;
    }

    public function rename(string $name): void
    {
        $this->name = trim($name);
        $this->refreshPublicSlug();
        $this->touch();
    }

    public function folder(): ?DeckFolder
    {
        return $this->folder;
    }

    public function visibility(): string
    {
        return $this->visibility;
    }

    public function slug(): ?string
    {
        return $this->slug;
    }

    public function publicSlug(): ?string
    {
        return $this->publicSlug;
    }

    public function publicPath(): ?string
    {
        return $this->publicSlug === null ? null : sprintf('/community/decks/%s/', $this->publicSlug);
    }

    public function format(): string
    {
        return $this->format;
    }

    public function isValid(): bool
    {
        return $this->valid;
    }

    public function markValidationResult(bool $valid): void
    {
        if ($this->valid === $valid) {
            return;
        }

        $this->valid = $valid;
        $this->touch();
    }

    public function markDecklistChanged(): void
    {
        $this->valid = false;
        $this->refreshPublicSlug();
        $this->touch();
    }

    public function backgroundName(): string
    {
        return $this->backgroundName;
    }

    public function sleevesName(): string
    {
        return $this->sleevesName;
    }

    public function setBackgroundName(string $backgroundName): void
    {
        $this->backgroundName = $backgroundName;
        $this->touch();
    }

    public function setSleevesName(string $sleevesName): void
    {
        $this->sleevesName = $sleevesName;
        $this->touch();
    }

    public function likes(): int
    {
        return $this->likes;
    }

    public function copies(): int
    {
        return $this->copies;
    }

    public function setVisibility(string $visibility): void
    {
        $this->visibility = in_array($visibility, [self::VISIBILITY_PRIVATE, self::VISIBILITY_PUBLIC], true)
            ? $visibility
            : self::VISIBILITY_PRIVATE;
        if ($this->visibility === self::VISIBILITY_PUBLIC) {
            $this->owner->ensurePublicHandle();
            $this->refreshPublicSlug();
        }
        $this->touch();
    }

    public function ensurePublicSlug(): void
    {
        if ($this->publicSlug !== null && $this->publicSlug !== '') {
            return;
        }

        $this->refreshPublicSlug();
    }

    public function ensureSlug(): void
    {
        if ($this->slug !== null && $this->slug !== '') {
            return;
        }

        $this->regenerateSlug();
    }

    public function regenerateSlug(): void
    {
        $this->slug = $this->buildDeckSlug(self::randomSlugSuffix());
    }

    public function setFormat(string $format): void
    {
        $this->format = DeckFormatCatalog::normalize($format) ?? DeckFormatCatalog::defaultId();
        $this->markDecklistChanged();
    }

    public function moveToFolder(?DeckFolder $folder): void
    {
        $this->folder = $folder;
        $this->touch();
    }

    public function clearCards(): void
    {
        $this->cards->clear();
        $this->markDecklistChanged();
    }

    public function addCard(DeckCard $card): void
    {
        $this->cards->add($card);
        $this->markDecklistChanged();
    }

    public function addOrIncrementCard(Card $card, int $quantity, string $section): DeckCard
    {
        $existing = $this->findCardEntry($card, $section);
        if ($existing instanceof DeckCard) {
            $existing->changeQuantity($existing->quantity() + $quantity);
            $this->markDecklistChanged();

            return $existing;
        }

        $deckCard = new DeckCard($this, $card, $quantity, $section);
        $this->addCard($deckCard);

        return $deckCard;
    }

    public function findCardEntry(Card $card, string $section): ?DeckCard
    {
        foreach ($this->cards as $deckCard) {
            if (!$deckCard instanceof DeckCard) {
                continue;
            }

            if ($deckCard->card()->scryfallId() === $card->scryfallId() && $deckCard->section() === $section) {
                return $deckCard;
            }
        }

        return null;
    }

    public function moveOrMergeCard(DeckCard $deckCard, string $section): DeckCard
    {
        if ($deckCard->section() === $section) {
            return $deckCard;
        }

        $existing = $this->findCardEntry($deckCard->card(), $section);
        if ($existing instanceof DeckCard) {
            $existing->changeQuantity($existing->quantity() + $deckCard->quantity());
            $this->removeCard($deckCard);
            $this->markDecklistChanged();

            return $existing;
        }

        $deckCard->moveToSection($section);
        $this->markDecklistChanged();

        return $deckCard;
    }

    public function replaceEquivalentCardPrint(DeckCard $deckCard, Card $targetCard): DeckCard
    {
        $existing = $this->findCardEntry($targetCard, $deckCard->section());
        if ($existing instanceof DeckCard && $existing->id() !== $deckCard->id()) {
            $existing->changeQuantity($existing->quantity() + $deckCard->quantity());
            $this->cards->removeElement($deckCard);
            $this->refreshPublicSlug();
            $this->touch();

            return $existing;
        }

        $deckCard->changeCard($targetCard);
        $this->refreshPublicSlug();
        $this->touch();

        return $deckCard;
    }

    public function removeCard(DeckCard $card): void
    {
        $this->cards->removeElement($card);
        $this->markDecklistChanged();
    }

    public function cards(): Collection
    {
        return $this->cards;
    }

    public function touch(): void
    {
        $this->updatedAt = new \DateTimeImmutable();
    }

    public function updatedAt(): \DateTimeImmutable
    {
        return $this->updatedAt;
    }

    public function toArray(bool $withCards = false): array
    {
        $commanderEntries = [];
        foreach ($this->cards as $deckCard) {
            if ($deckCard instanceof DeckCard && $deckCard->section() === DeckCard::SECTION_COMMANDER) {
                $commanderEntries[] = $deckCard;
            }
        }

        usort(
            $commanderEntries,
            static fn (DeckCard $left, DeckCard $right): int => $left->id() <=> $right->id(),
        );
        $commanders = array_map(
            static fn (DeckCard $deckCard): array => $deckCard->card()->toArray(),
            $commanderEntries,
        );

        $data = [
            'id' => $this->id,
            'name' => $this->name,
            'format' => $this->format,
            'valid' => $this->valid,
            'visibility' => $this->visibility,
            'slug' => $this->slug,
            'publicSlug' => $this->publicSlug,
            'canonicalPath' => $this->publicPath(),
            'creatorUserId' => $this->creatorUser->id(),
            'likes' => $this->likes,
            'copies' => $this->copies,
            'backgroundName' => $this->backgroundName,
            'sleevesName' => $this->sleevesName,
            'folderId' => $this->folder?->id(),
            'commanders' => $commanders,
        ];

        if ($withCards) {
            $data['cards'] = array_map(static fn (DeckCard $card) => $card->toArray(), $this->cards->toArray());
        }

        return $data;
    }

    private function buildDeckSlug(string $suffix): string
    {
        return sprintf(
            '%s-%s-%s-%s',
            self::slugPart(implode('-', $this->commanderNames()) ?: 'deck', 96),
            self::slugPart($this->name, 72),
            self::slugPart($this->format, 32),
            $suffix,
        );
    }

    private function refreshPublicSlug(): void
    {
        if ($this->visibility !== self::VISIBILITY_PUBLIC) {
            return;
        }

        $this->publicSlug = $this->buildDeckSlug($this->publicSlugSuffix());
    }

    /**
     * @return list<string>
     */
    private function commanderNames(): array
    {
        $commanderEntries = [];
        foreach ($this->cards as $deckCard) {
            if ($deckCard instanceof DeckCard && $deckCard->section() === DeckCard::SECTION_COMMANDER) {
                $commanderEntries[] = $deckCard;
            }
        }

        usort(
            $commanderEntries,
            static fn (DeckCard $left, DeckCard $right): int => $left->id() <=> $right->id(),
        );

        return array_values(array_map(
            static fn (DeckCard $deckCard): string => $deckCard->card()->name(),
            $commanderEntries,
        ));
    }

    private static function slugPart(string $value, int $maxLength = 140): string
    {
        $slug = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);
        if (!is_string($slug)) {
            $slug = $value;
        }

        $slug = strtolower(trim($slug));
        $slug = preg_replace('/[^a-z0-9]+/', '-', $slug) ?? '';
        $slug = trim($slug, '-');

        return $slug !== '' ? substr($slug, 0, $maxLength) : 'deck';
    }

    private static function randomSlugSuffix(): string
    {
        $compact = preg_replace('/[^a-z0-9]/i', '', Uuid::v7()->toRfc4122()) ?? '';

        return strtolower(substr($compact, -8));
    }

    private function shortPublicId(): string
    {
        $compact = preg_replace('/[^a-z0-9]/i', '', $this->id) ?? '';

        return strtolower(substr($compact !== '' ? $compact : $this->id, -8));
    }

    private function publicSlugSuffix(): string
    {
        $currentSlug = trim((string) $this->publicSlug);
        if ($currentSlug === '') {
            return $this->shortPublicId();
        }

        $parts = explode('-', $currentSlug);
        $suffix = strtolower(trim((string) end($parts)));

        return $suffix !== '' ? $suffix : $this->shortPublicId();
    }
}
