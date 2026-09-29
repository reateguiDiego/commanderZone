<?php

declare(strict_types=1);

namespace App\Application\Moderation;

use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckFolder;
use App\Domain\Room\Room;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Produces an explicitly allow-listed moderation snapshot of editable user
 * content. Private names are included only because a reviewer may need to
 * assess abusive content in them.
 * It must never reuse User::toArray(), which is an authenticated API payload.
 */
class ModerationProfileSnapshotFactory
{
    public function __construct(private readonly EntityManagerInterface $entityManager)
    {
    }

    /** @return array<string,mixed> */
    public function create(User $user): array
    {
        $profile = [
            'displayName' => $user->displayName(),
            'publicHandle' => $user->publicHandle(),
        ];
        $avatar = $this->uploadedAvatar($user);
        if ($avatar !== null) {
            // Uploaded avatars are editable user content. Copy the image data
            // rather than the mutable /users/{id}/avatar route so a reviewer
            // sees exactly what was present when evidence was captured.
            $profile['avatar'] = $avatar;
        }

        return [
            'capturedAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
            'user' => $profile,
            // Name is the sole editable, moderation-relevant field from a
            // folder, deck, or owned room. These lists intentionally include
            // private entries, but no IDs, configuration, or contents.
            'folders' => $this->folderNames($user),
            'decks' => $this->deckNames($user),
            'ownedRooms' => $this->ownedRoomNames($user),
        ];
    }

    /** @return list<array{name:string}> */
    private function folderNames(User $user): array
    {
        $rows = $this->entityManager->getRepository(DeckFolder::class)->createQueryBuilder('folder')
            ->select('folder.name AS name')
            ->where('folder.owner = :owner')
            ->setParameter('owner', $user)
            ->orderBy('folder.createdAt', 'ASC')
            ->addOrderBy('folder.id', 'ASC')
            ->getQuery()
            ->getScalarResult();

        return $this->namesFromRows($rows);
    }

    /** @return list<array{name:string}> */
    private function deckNames(User $user): array
    {
        $rows = $this->entityManager->getRepository(Deck::class)->createQueryBuilder('deck')
            ->select('deck.name AS name')
            ->where('deck.owner = :owner')
            ->setParameter('owner', $user)
            ->orderBy('deck.createdAt', 'ASC')
            ->addOrderBy('deck.id', 'ASC')
            ->getQuery()
            ->getScalarResult();

        return $this->namesFromRows($rows);
    }

    /** @return list<array{name:string}> */
    private function ownedRoomNames(User $user): array
    {
        $rows = $this->entityManager->getRepository(Room::class)->createQueryBuilder('room')
            ->select('room.name AS name')
            ->where('room.owner = :owner')
            ->setParameter('owner', $user)
            ->orderBy('room.createdAt', 'ASC')
            ->addOrderBy('room.id', 'ASC')
            ->getQuery()
            ->getScalarResult();

        return $this->namesFromRows($rows);
    }

    /**
     * @param list<array<string,mixed>> $rows
     *
     * @return list<array{name:string}>
     */
    private function namesFromRows(array $rows): array
    {
        return array_values(array_map(
            static fn (array $row): array => ['name' => (string) ($row['name'] ?? '')],
            $rows,
        ));
    }

    /** @return array{type:string,imageData:string}|null */
    private function uploadedAvatar(User $user): ?array
    {
        $avatar = $user->avatar();
        $imageData = $user->avatarImageData();
        if (($avatar['type'] ?? null) !== 'upload' || !is_string($imageData) || $imageData === '') {
            return null;
        }

        return [
            'type' => 'upload',
            'imageData' => $imageData,
        ];
    }
}
