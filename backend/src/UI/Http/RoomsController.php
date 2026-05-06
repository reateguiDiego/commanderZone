<?php

namespace App\UI\Http;

use App\Application\Deck\CommanderDeckValidator;
use App\Application\Game\GameSnapshotFactory;
use App\Domain\Deck\Deck;
use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\Room\RoomInvite;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use App\Infrastructure\Realtime\RoomEventPublisher;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class RoomsController extends ApiController
{
    #[Route('/rooms', methods: ['GET'])]
    public function list(Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $status = (string) $request->query->get('status', 'active');
        $queryBuilder = $entityManager->getRepository(Room::class)->createQueryBuilder('room')
            ->distinct()
            ->leftJoin('room.players', 'player')
            ->addSelect('player')
            ->leftJoin(
                RoomInvite::class,
                'invite',
                'WITH',
                'invite.room = room AND invite.recipient = :user AND invite.status = :pendingInvite',
            )
            ->where('((room.status = :waiting AND room.visibility = :public)')
            ->orWhere('room.owner = :user')
            ->orWhere('player.user = :user')
            ->orWhere('invite.id IS NOT NULL)')
            ->setParameter('waiting', Room::STATUS_WAITING)
            ->setParameter('public', Room::VISIBILITY_PUBLIC)
            ->setParameter('pendingInvite', RoomInvite::STATUS_PENDING)
            ->setParameter('user', $user);

        if ($status === 'archived') {
            $queryBuilder
                ->andWhere('room.status = :archived')
                ->setParameter('archived', Room::STATUS_ARCHIVED);
        } elseif ($status !== 'all') {
            $queryBuilder
                ->andWhere('room.status != :archived')
                ->setParameter('archived', Room::STATUS_ARCHIVED);
        }

        $rooms = $queryBuilder
            ->orderBy('room.createdAt', 'DESC')
            ->getQuery()
            ->getResult();

        return $this->json(['data' => array_map(static fn (Room $room) => $room->toArray(), $rooms)]);
    }

    #[Route('/rooms', methods: ['POST'])]
    public function create(Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager, RoomEventPublisher $roomEventPublisher): JsonResponse
    {
        $payload = $this->payload($request);
        $hasDeckInPayload = $this->hasDeckIdInPayload($payload);
        $deck = $this->deckFromPayload($payload, $user, $entityManager);
        if ($hasDeckInPayload && !$deck instanceof Deck) {
            return $this->fail('A valid deck is required to create a room.');
        }

        $this->closeOwnerActiveRooms($entityManager, $user, $roomEventPublisher);

        $format = (string) ($payload['format'] ?? Room::FORMAT_COMMANDER);
        if ($format !== Room::FORMAT_COMMANDER) {
            return $this->fail('Only Commander format is currently supported.', 400);
        }

        $room = new Room($user);
        $room->setVisibility((string) ($payload['visibility'] ?? Room::VISIBILITY_PRIVATE));
        $room->setFormat($format);
        $room->setName((string) ($payload['name'] ?? ''));
        $room->setMaxPlayers($this->maxPlayersFromPayload($payload));
        $room->addPlayer(new RoomPlayer($room, $user, $deck));

        $entityManager->persist($room);
        $entityManager->flush();
        $roomEventPublisher->publish($room, 'room.created');

        return $this->json(['room' => $room->toArray()], 201);
    }

    #[Route('/rooms/{id}', methods: ['GET'])]
    public function show(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $room = $entityManager->getRepository(Room::class)->find($id);
        if (!$room instanceof Room) {
            return $this->fail('Room not found.', 404);
        }
        $isInvited = $this->isInvitedToRoom($room, $user, $entityManager);
        if (!$room->canBeViewedBy($user, $isInvited)) {
            return $this->fail('Room access denied.', 403);
        }

        return $this->json(['room' => $room->toArray()]);
    }

    #[Route('/rooms/{id}', methods: ['PATCH'])]
    public function update(string $id, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager, RoomEventPublisher $roomEventPublisher): JsonResponse
    {
        $room = $entityManager->getRepository(Room::class)->find($id);
        if (!$room instanceof Room) {
            return $this->fail('Room not found.', 404);
        }
        if ($room->owner()->id() !== $user->id()) {
            return $this->fail('Only the room owner can update the room.', 403);
        }
        if ($room->status() !== Room::STATUS_WAITING) {
            return $this->fail('Started rooms cannot be updated.', 409);
        }

        $payload = $this->payload($request);
        if (array_key_exists('maxPlayers', $payload)) {
            $maxPlayers = $this->maxPlayersFromPayload($payload);
            if ($maxPlayers < $room->players()->count()) {
                return $this->fail('Max players cannot be lower than current players.', 400);
            }
            $room->setMaxPlayers($maxPlayers);
        }

        $entityManager->flush();
        $roomEventPublisher->publish($room, 'room.updated');

        return $this->json(['room' => $room->toArray()]);
    }

    #[Route('/rooms/{id}/join', methods: ['POST'])]
    public function join(
        string $id,
        Request $request,
        #[CurrentUser] User $user,
        EntityManagerInterface $entityManager,
        CommanderDeckValidator $deckValidator,
        RoomEventPublisher $roomEventPublisher,
    ): JsonResponse
    {
        $room = $entityManager->getRepository(Room::class)->find($id);
        if (!$room instanceof Room) {
            return $this->fail('Room not found.', 404);
        }
        if ($room->status() !== Room::STATUS_WAITING) {
            return $this->fail('Room has already started.', 409);
        }
        if ($room->visibility() === Room::VISIBILITY_PRIVATE
            && !$room->hasPlayer($user)
            && !$this->isInvitedToRoom($room, $user, $entityManager)) {
            return $this->fail('Private room access denied.', 403);
        }
        if (!$room->hasPlayer($user) && $room->isFull()) {
            return $this->fail('Room is full.', 409);
        }

        $payload = $this->payload($request);
        $hasDeckInPayload = $this->hasDeckIdInPayload($payload);
        $deck = $this->deckFromPayload($payload, $user, $entityManager);
        if ($hasDeckInPayload && !$deck instanceof Deck) {
            return $this->fail('A valid deck is required to join a room.');
        }
        if ($deck instanceof Deck) {
            $validation = $deckValidator->validate($deck);
            if (($validation['valid'] ?? false) !== true) {
                return $this->fail('A Commander-valid deck is required to join a room.', 400, [
                    'validation' => $validation,
                ]);
            }
        }

        $wasPlayer = $room->hasPlayer($user);
        if (!$room->addPlayer(new RoomPlayer($room, $user, $deck))) {
            return $this->fail('Room is full.', 409);
        }
        $entityManager->flush();
        $roomEventPublisher->publish($room, $wasPlayer ? 'room.player.updated' : 'room.player.joined');

        return $this->json(['room' => $room->toArray()]);
    }

    #[Route('/rooms/{id}/roll-turn', methods: ['POST'])]
    public function rollTurn(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager, RoomEventPublisher $roomEventPublisher): JsonResponse
    {
        $room = $entityManager->getRepository(Room::class)->find($id);
        if (!$room instanceof Room) {
            return $this->fail('Room not found.', 404);
        }
        if ($room->status() !== Room::STATUS_WAITING) {
            return $this->fail('Room has already started.', 409);
        }

        $player = $room->playerFor($user);
        if (!$player instanceof RoomPlayer) {
            return $this->fail('Only room players can roll turn order.', 403);
        }
        if (!$player->deck() instanceof Deck) {
            return $this->fail('Select a Commander-valid deck before rolling.', 400);
        }
        if ($player->turnRoll() !== null) {
            return $this->fail('Turn order has already been rolled.', 409);
        }

        $player->rollTurnOrder(random_int(1, 20));
        $entityManager->flush();
        $roomEventPublisher->publish($room, 'room.player.rolled');

        return $this->json(['room' => $room->toArray()]);
    }

    #[Route('/rooms/{id}/leave', methods: ['POST'])]
    public function leave(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager, RoomEventPublisher $roomEventPublisher): JsonResponse
    {
        $room = $entityManager->getRepository(Room::class)->find($id);
        if (!$room instanceof Room) {
            return $this->fail('Room not found.', 404);
        }
        if ($room->status() !== Room::STATUS_WAITING) {
            return $this->fail('Started rooms cannot be left.', 409);
        }
        if (!$room->hasPlayer($user)) {
            return $this->fail('Only room players can leave the room.', 403);
        }

        $room->removeUser($user);
        $entityManager->flush();
        $roomEventPublisher->publish($room, 'room.player.left');

        return $this->json(['room' => $room->toArray()]);
    }

    #[Route('/rooms/{id}', methods: ['DELETE'])]
    public function delete(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager, RoomEventPublisher $roomEventPublisher): JsonResponse
    {
        $room = $entityManager->getRepository(Room::class)->find($id);
        if (!$room instanceof Room) {
            return $this->fail('Room not found.', 404);
        }
        if ($room->owner()->id() !== $user->id()) {
            return $this->fail('Only the room owner can delete the room.', 403);
        }
        if ($room->status() !== Room::STATUS_WAITING) {
            return $this->fail('Started rooms cannot be deleted.', 409);
        }

        $entityManager->remove($room);
        $entityManager->flush();
        $roomEventPublisher->publishDeleted($id);

        return $this->json(null, 204);
    }

    #[Route('/rooms/{id}/archive', methods: ['POST'])]
    public function archive(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $room = $entityManager->getRepository(Room::class)->find($id);
        if (!$room instanceof Room) {
            return $this->fail('Room not found.', 404);
        }
        if ($room->owner()->id() !== $user->id()) {
            return $this->fail('Only the room owner can archive the room.', 403);
        }
        if ($room->status() === Room::STATUS_ARCHIVED) {
            return $this->json(['room' => $room->toArray()]);
        }
        if ($room->status() !== Room::STATUS_STARTED && !$room->game() instanceof Game) {
            return $this->fail('Only started rooms can be archived.', 409);
        }

        $room->archive();
        $room->game()?->finish();
        $entityManager->flush();

        return $this->json(['room' => $room->toArray()]);
    }

    #[Route('/rooms/{id}/start', methods: ['POST'])]
    public function start(
        string $id,
        #[CurrentUser] User $user,
        EntityManagerInterface $entityManager,
        GameSnapshotFactory $snapshotFactory,
        CommanderDeckValidator $deckValidator,
        RoomEventPublisher $roomEventPublisher,
    ): JsonResponse
    {
        $room = $entityManager->getRepository(Room::class)->find($id);
        if (!$room instanceof Room) {
            return $this->fail('Room not found.', 404);
        }
        if ($room->owner()->id() !== $user->id()) {
            return $this->fail('Only the room owner can start the game.', 403);
        }
        if ($room->status() !== Room::STATUS_WAITING) {
            return $this->fail('Room has already started.', 409);
        }
        if ($room->players()->count() < Room::MIN_PLAYERS) {
            return $this->fail('At least two players are required.');
        }
        if ($room->players()->count() !== $room->maxPlayers()) {
            return $this->fail('The room must be full before starting the game.');
        }
        foreach ($room->players() as $player) {
            if (!$player instanceof RoomPlayer || !$player->deck() instanceof Deck) {
                return $this->fail('Every player needs a deck before starting the game.');
            }
            if ($player->turnRoll() === null) {
                return $this->fail('Every player needs a turn-order roll before starting the game.');
            }
        }
        $invalidDecks = [];
        foreach ($room->players() as $player) {
            if (!$player instanceof RoomPlayer) {
                continue;
            }

            $deck = $player->deck();
            if (!$deck instanceof Deck) {
                continue;
            }

            $playerData = [
                'playerId' => $player->user()->id(),
                'displayName' => $player->user()->displayName(),
                'deckId' => $deck->id(),
            ];
            if ($deck->owner()->id() !== $player->user()->id()) {
                $invalidDecks[] = [
                    ...$playerData,
                    'errors' => [[
                        'code' => 'deck.owner_mismatch',
                        'title' => 'Deck owner mismatch',
                        'detail' => 'Player must use their own deck.',
                        'cards' => [],
                    ]],
                ];
                continue;
            }

            $validation = $deckValidator->validate($deck);
            if (($validation['valid'] ?? false) !== true) {
                $invalidDecks[] = [
                    ...$playerData,
                    'validation' => $validation,
                ];
            }
        }
        if ($invalidDecks !== []) {
            return $this->fail(
                'Every player must have a Commander-valid deck before starting the game.',
                400,
                ['invalidDecks' => $invalidDecks],
            );
        }

        $game = new Game($room, $snapshotFactory->fromRoom($room));
        $room->start($game);
        $entityManager->persist($game);
        $entityManager->flush();
        $roomEventPublisher->publish($room, 'room.started');

        return $this->json(['room' => $room->toArray(), 'game' => $game->toArray()], 201);
    }

    private function deckFromPayload(array $payload, User $user, EntityManagerInterface $entityManager): ?Deck
    {
        $deckId = $payload['deckId'] ?? null;
        if (!is_string($deckId) || $deckId === '') {
            return null;
        }

        $deck = $entityManager->getRepository(Deck::class)->find($deckId);

        return $deck instanceof Deck && $deck->owner()->id() === $user->id() ? $deck : null;
    }

    private function closeOwnerActiveRooms(EntityManagerInterface $entityManager, User $owner, RoomEventPublisher $roomEventPublisher): void
    {
        $ownedRooms = $entityManager->getRepository(Room::class)->createQueryBuilder('room')
            ->where('room.owner = :owner')
            ->setParameter('owner', $owner)
            ->getQuery()
            ->getResult();

        $ownedGames = [];
        foreach ($ownedRooms as $ownedRoom) {
            if (!$ownedRoom instanceof Room) {
                continue;
            }

            $game = $ownedRoom->game();
            if ($game instanceof Game) {
                $ownedRoom->detachGame();
                $ownedGames[] = $game;
            }
        }

        $entityManager->flush();

        foreach ($ownedGames as $ownedGame) {
            $entityManager->remove($ownedGame);
        }

        $entityManager->flush();

        $removedRoomIds = [];
        foreach ($ownedRooms as $ownedRoom) {
            if (!$ownedRoom instanceof Room) {
                continue;
            }

            $removedRoomIds[] = $ownedRoom->id();
            $entityManager->remove($ownedRoom);
        }
        $entityManager->flush();

        foreach ($removedRoomIds as $removedRoomId) {
            $roomEventPublisher->publishDeleted($removedRoomId);
        }
    }

    private function isInvitedToRoom(Room $room, User $user, EntityManagerInterface $entityManager): bool
    {
        $invite = $entityManager->getRepository(RoomInvite::class)->findOneBy([
            'room' => $room,
            'recipient' => $user,
            'status' => RoomInvite::STATUS_PENDING,
        ]);

        return $invite instanceof RoomInvite;
    }

    private function maxPlayersFromPayload(array $payload): int
    {
        $maxPlayers = $payload['maxPlayers'] ?? Room::DEFAULT_MAX_PLAYERS;
        if (is_int($maxPlayers)) {
            return $maxPlayers;
        }
        if (is_numeric($maxPlayers)) {
            return (int) $maxPlayers;
        }

        return Room::DEFAULT_MAX_PLAYERS;
    }

    private function hasDeckIdInPayload(array $payload): bool
    {
        return isset($payload['deckId']) && is_string($payload['deckId']) && trim($payload['deckId']) !== '';
    }
}
