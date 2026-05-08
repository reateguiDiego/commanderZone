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
            ->addSelect('player');

        if ($status === 'archived') {
            $queryBuilder
                ->andWhere('room.status = :archived')
                ->andWhere('(room.owner = :user OR player.user = :user)')
                ->setParameter('archived', Room::STATUS_ARCHIVED)
                ->setParameter('user', $user);
        } elseif ($status !== 'all') {
            $queryBuilder
                ->andWhere('room.status != :archived')
                ->setParameter('archived', Room::STATUS_ARCHIVED);
        }

        $rooms = $queryBuilder
            ->getQuery()
            ->getResult();
        usort($rooms, static fn (Room $left, Room $right): int => self::roomListRank($left) <=> self::roomListRank($right)
            ?: $left->name() <=> $right->name());

        return $this->json(['data' => array_map(fn (Room $room) => $this->roomListArray($room, $user), $rooms)]);
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
        $room->setStartingLife($this->startingLifeFromPayload($payload));
        $room->setTimerMode($this->timerModeFromPayload($payload));
        $room->setTimerDurationSeconds($this->timerDurationFromPayload($payload));
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
        if (!$room->canBeViewedBy($user)) {
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
        if (array_key_exists('startingLife', $payload)) {
            $room->setStartingLife($this->startingLifeFromPayload($payload));
        }
        if (array_key_exists('timerMode', $payload)) {
            $room->setTimerMode($this->timerModeFromPayload($payload));
        }
        if (array_key_exists('timerDurationSeconds', $payload)) {
            $room->setTimerDurationSeconds($this->timerDurationFromPayload($payload));
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

        return $this->joinRoom($room, $request, $user, $entityManager, $deckValidator, $roomEventPublisher);
    }

    #[Route('/rooms/code/{code}/join', methods: ['POST'])]
    public function joinByCode(
        string $code,
        Request $request,
        #[CurrentUser] User $user,
        EntityManagerInterface $entityManager,
        CommanderDeckValidator $deckValidator,
        RoomEventPublisher $roomEventPublisher,
    ): JsonResponse
    {
        $room = $this->roomFromCode($code, $entityManager);
        if (!$room instanceof Room) {
            return $this->fail('Room not found.', 404);
        }

        return $this->joinRoom($room, $request, $user, $entityManager, $deckValidator, $roomEventPublisher);
    }

    private function joinRoom(
        Room $room,
        Request $request,
        User $user,
        EntityManagerInterface $entityManager,
        CommanderDeckValidator $deckValidator,
        RoomEventPublisher $roomEventPublisher,
    ): JsonResponse
    {
        if ($room->status() !== Room::STATUS_WAITING) {
            return $this->fail('Room has already started.', 409);
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

    #[Route('/rooms/{id}/players/{playerId}', methods: ['DELETE'])]
    public function kickPlayer(
        string $id,
        string $playerId,
        #[CurrentUser] User $user,
        EntityManagerInterface $entityManager,
        RoomEventPublisher $roomEventPublisher,
    ): JsonResponse
    {
        $room = $entityManager->getRepository(Room::class)->find($id);
        if (!$room instanceof Room) {
            return $this->fail('Room not found.', 404);
        }
        if ($room->owner()->id() !== $user->id()) {
            return $this->fail('Only the room owner can kick players.', 403);
        }
        if ($room->status() !== Room::STATUS_WAITING) {
            return $this->fail('Started rooms cannot be modified.', 409);
        }

        $targetPlayer = $this->roomPlayerById($room, $playerId);
        if (!$targetPlayer instanceof RoomPlayer) {
            return $this->fail('Room player not found.', 404);
        }
        if ($targetPlayer->user()->id() === $room->owner()->id()) {
            return $this->fail('The room owner cannot be kicked.', 400);
        }

        $room->removeUser($targetPlayer->user());
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

    private function roomFromCode(string $code, EntityManagerInterface $entityManager): ?Room
    {
        $compactCode = strtoupper((string) preg_replace('/[^A-Fa-f0-9]/', '', $code));
        if (strlen($compactCode) < 9) {
            return null;
        }

        $suffix = strtolower(substr($compactCode, -9));
        $rooms = $entityManager->getRepository(Room::class)->createQueryBuilder('room')
            ->where('room.status = :waiting')
            ->setParameter('waiting', Room::STATUS_WAITING)
            ->getQuery()
            ->getResult();

        $matches = [];
        foreach ($rooms as $room) {
            if (!$room instanceof Room) {
                continue;
            }

            $compactRoomId = strtolower(str_replace('-', '', $room->id()));
            if (str_ends_with($compactRoomId, $suffix)) {
                $matches[] = $room;
            }
        }

        return count($matches) === 1 ? $matches[0] : null;
    }

    private function roomPlayerById(Room $room, string $playerId): ?RoomPlayer
    {
        foreach ($room->players() as $player) {
            if ($player instanceof RoomPlayer && $player->id() === $playerId) {
                return $player;
            }
        }

        return null;
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

    private function roomListArray(Room $room, User $viewer): array
    {
        $data = $room->toArray();
        if ($room->visibility() === Room::VISIBILITY_PRIVATE && $room->owner()->id() !== $viewer->id()) {
            $data['owner'] = [
                'id' => 'private-host-'.$room->id(),
                'email' => '',
                'displayName' => 'XXXX',
                'roles' => ['ROLE_USER'],
            ];
        }

        return $data;
    }

    private static function roomListRank(Room $room): int
    {
        $visibilityRank = $room->visibility() === Room::VISIBILITY_PUBLIC ? 0 : 100;
        $statusRank = match (true) {
            $room->status() === Room::STATUS_WAITING && !$room->isFull() => 0,
            $room->status() === Room::STATUS_WAITING => 10,
            $room->status() === Room::STATUS_STARTED || $room->game() instanceof Game => 20,
            default => 30,
        };

        return $visibilityRank + $statusRank;
    }

    private function startingLifeFromPayload(array $payload): int
    {
        $startingLife = $payload['startingLife'] ?? Room::DEFAULT_STARTING_LIFE;
        if (is_int($startingLife)) {
            return $startingLife;
        }
        if (is_numeric($startingLife)) {
            return (int) $startingLife;
        }

        return Room::DEFAULT_STARTING_LIFE;
    }

    private function timerModeFromPayload(array $payload): string
    {
        $timerMode = $payload['timerMode'] ?? Room::DEFAULT_TIMER_MODE;

        return is_string($timerMode) ? $timerMode : Room::DEFAULT_TIMER_MODE;
    }

    private function timerDurationFromPayload(array $payload): int
    {
        $duration = $payload['timerDurationSeconds'] ?? Room::DEFAULT_TIMER_DURATION_SECONDS;
        if (is_int($duration)) {
            return $duration;
        }
        if (is_numeric($duration)) {
            return (int) $duration;
        }

        return Room::DEFAULT_TIMER_DURATION_SECONDS;
    }

    private function hasDeckIdInPayload(array $payload): bool
    {
        return isset($payload['deckId']) && is_string($payload['deckId']) && trim($payload['deckId']) !== '';
    }
}
