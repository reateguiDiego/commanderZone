<?php

namespace App\UI\Http;

use App\Application\Deck\CommanderDeckValidator;
use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameProjectionService;
use App\Application\Game\GameRematchService;
use App\Application\Game\GameSnapshotFactory;
use App\Application\Room\ActiveRoomMembershipService;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Room\Room;
use App\Domain\Room\RoomInvite;
use App\Domain\Room\RoomPlayer;
use App\Domain\Room\RoomWaitingLogEntry;
use App\Domain\User\User;
use App\Infrastructure\Realtime\GameEventPublisher;
use App\Infrastructure\Realtime\RoomEventPublisher;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Log\LoggerInterface;
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
            ->leftJoin('room.players', 'player')
            ->addSelect('player');

        if (!in_array($status, ['active', 'all'], true)) {
            return $this->fail('Unsupported room status filter.', 400);
        }

        $queryBuilder
            ->andWhere('room.status != :archived')
            ->setParameter('archived', Room::STATUS_ARCHIVED);

        $rooms = $queryBuilder
            ->getQuery()
            ->getResult();
        usort($rooms, static fn (Room $left, Room $right): int => self::roomListRank($left) <=> self::roomListRank($right)
            ?: $left->name() <=> $right->name());

        return $this->json(['data' => array_map(fn (Room $room) => $this->roomListArray($room, $user), $rooms)]);
    }

    #[Route('/rooms/current', methods: ['GET'])]
    public function current(#[CurrentUser] User $user, ActiveRoomMembershipService $activeRoomMembership): JsonResponse
    {
        $room = $activeRoomMembership->currentRoomFor($user);

        if (!$room instanceof Room) {
            return $this->json(['room' => null, 'player' => null, 'turn' => null, 'viewerRole' => null]);
        }

        return $this->json([
            'room' => $this->currentRoomSummaryArray($room),
            'player' => $this->currentRoomPlayerArray($room->playerFor($user)),
            'turn' => $this->currentRoomTurnArray($room),
            'viewerRole' => $this->currentRoomViewerRole($room, $user),
        ]);
    }

    #[Route('/rooms', methods: ['POST'])]
    public function create(
        Request $request,
        #[CurrentUser] User $user,
        EntityManagerInterface $entityManager,
        RoomEventPublisher $roomEventPublisher,
        ActiveRoomMembershipService $activeRoomMembership,
        LoggerInterface $logger,
    ): JsonResponse
    {
        $payload = $this->payload($request);
        $hasDeckInPayload = $this->hasDeckIdInPayload($payload);
        $deck = $this->deckFromPayload($payload, $user, $entityManager);
        if ($hasDeckInPayload && !$deck instanceof Deck) {
            return $this->fail('A valid deck is required to create a room.');
        }

        $format = (string) ($payload['format'] ?? Room::FORMAT_COMMANDER);
        if ($format !== Room::FORMAT_COMMANDER) {
            return $this->fail('Only Commander format is currently supported.', 400);
        }

        $deletedRoomIds = [];
        foreach ($activeRoomMembership->activeRoomsForUser($user) as $existingRoom) {
            $deletedRoomIds[] = $existingRoom->id();
            $this->removeRoomWithGame($existingRoom, $entityManager);
        }
        if ($deletedRoomIds !== []) {
            $entityManager->flush();
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
        $room->appendWaitingLog(sprintf('%s joined the room.', $this->userDisplayName($user)), RoomWaitingLogEntry::TONE_SUCCESS);

        try {
            $entityManager->persist($room);
            $entityManager->flush();
        } catch (\Throwable $exception) {
            $logger->critical('Room creation failed while persisting waiting room state. Check pending migrations/schema mismatch.', [
                'ownerId' => $user->id(),
                'ownerEmail' => $user->email(),
                'roomVisibility' => $room->visibility(),
                'roomFormat' => $room->format(),
                'payloadKeys' => array_keys($payload),
                'exception' => $exception,
            ]);

            throw $exception;
        }
        foreach ($deletedRoomIds as $deletedRoomId) {
            $roomEventPublisher->publishDeleted($deletedRoomId);
        }
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
        $previousMaxPlayers = $room->maxPlayers();
        $previousStartingLife = $room->startingLife();
        $previousTimerMode = $room->timerMode();
        $previousTimerDurationSeconds = $room->timerDurationSeconds();
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
        $this->appendRoomSettingsLog($room, $previousMaxPlayers, $previousStartingLife, $previousTimerMode, $previousTimerDurationSeconds);

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
        ActiveRoomMembershipService $activeRoomMembership,
    ): JsonResponse
    {
        $room = $entityManager->getRepository(Room::class)->find($id);
        if (!$room instanceof Room) {
            return $this->fail('Room not found.', 404);
        }

        return $this->joinRoom($room, $request, $user, $entityManager, $deckValidator, $roomEventPublisher, $activeRoomMembership);
    }

    #[Route('/rooms/code/{code}/join', methods: ['POST'])]
    public function joinByCode(
        string $code,
        Request $request,
        #[CurrentUser] User $user,
        EntityManagerInterface $entityManager,
        CommanderDeckValidator $deckValidator,
        RoomEventPublisher $roomEventPublisher,
        ActiveRoomMembershipService $activeRoomMembership,
    ): JsonResponse
    {
        $room = $this->roomFromCode($code, $entityManager);
        if (!$room instanceof Room) {
            return $this->fail('Room not found.', 404);
        }

        return $this->joinRoom($room, $request, $user, $entityManager, $deckValidator, $roomEventPublisher, $activeRoomMembership);
    }

    private function joinRoom(
        Room $room,
        Request $request,
        User $user,
        EntityManagerInterface $entityManager,
        CommanderDeckValidator $deckValidator,
        RoomEventPublisher $roomEventPublisher,
        ActiveRoomMembershipService $activeRoomMembership,
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
        $previousDeckId = $wasPlayer ? $room->playerFor($user)?->deck()?->id() : null;
        if (!$wasPlayer && $activeRoomMembership->otherRoomFor($user, $room) instanceof Room) {
            return $this->fail('Leave your current room before joining another room.', 409);
        }
        if (!$room->addPlayer(new RoomPlayer($room, $user, $deck))) {
            return $this->fail('Room is full.', 409);
        }
        if (!$wasPlayer) {
            $room->appendWaitingLog(sprintf('%s joined the room.', $this->userDisplayName($user)), RoomWaitingLogEntry::TONE_SUCCESS);
        } elseif ($deck instanceof Deck && $deck->id() !== $previousDeckId) {
            $room->appendWaitingLog(sprintf('%s selected deck: %s.', $this->userDisplayName($user), $deck->name()));
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
        if (!$room->canPlayerRollTurnOrder($player)) {
            return $this->fail('Turn order has already been rolled.', 409);
        }

        $player->rollTurnOrder($this->uniqueTurnOrderRoll($room, $player));
        $room->appendWaitingLog(sprintf('%s rolled %s.', $this->userDisplayName($user), implode(' - ', $player->turnRolls())));
        $entityManager->flush();
        $roomEventPublisher->publish($room, 'room.player.rolled');

        return $this->json(['room' => $room->toArray()]);
    }

    #[Route('/rooms/{id}/leave', methods: ['POST'])]
    public function leave(
        string $id,
        #[CurrentUser] User $user,
        EntityManagerInterface $entityManager,
        RoomEventPublisher $roomEventPublisher,
        GameCommandHandler $gameCommandHandler,
        GameEventPublisher $gameEventPublisher,
        GameRematchService $gameRematch,
    ): JsonResponse
    {
        $room = $entityManager->getRepository(Room::class)->find($id);
        if (!$room instanceof Room) {
            return $this->fail('Room not found.', 404);
        }
        if (!$room->hasPlayer($user)) {
            return $this->fail('Only room players can leave the room.', 403);
        }

        $startedRoom = $room->status() === Room::STATUS_STARTED || $room->game() instanceof Game;
        if ($room->owner()->id() === $user->id() && !$startedRoom) {
            $this->removeRoomWithGame($room, $entityManager);
            $entityManager->flush();
            $roomEventPublisher->publishDeleted($id);

            return $this->json(['left' => true, 'roomDeleted' => true]);
        }

        $leavingName = $this->userDisplayName($user);
        $game = $room->game();
        $gameRealtimeEvent = null;
        $roomDeleted = false;

        try {
            $entityManager->beginTransaction();
            if ($game instanceof Game) {
                $entityManager->lock($game, LockMode::PESSIMISTIC_WRITE);
            }

            $lastRoomPlayer = $room->players()->count() === 1;
            if (!$lastRoomPlayer && $startedRoom && $game instanceof Game && $this->gameHasSnapshotPlayer($game, $user)) {
                if ($this->gameCanConcedeLeavingPlayer($game, $user)) {
                    $gameConcedeEvent = $gameCommandHandler->apply($game, 'game.concede', [], $user);
                    $entityManager->persist($gameConcedeEvent);
                    $gameRealtimeEvent = $gameConcedeEvent;
                }

                if ($this->gameCanRecordLeaveVote($game, $user)) {
                    $recorded = $gameRematch->recordVote($game, $user, GameRematchService::VOTE_LEAVE);
                    $entityManager->persist($recorded['event']);
                    $gameRealtimeEvent = $recorded['event'];
                }
            }

            $room->removeUser($user);
            if ($room->players()->count() === 0) {
                $this->removeRoomWithGame($room, $entityManager);
                $roomDeleted = true;
            } else {
                $room->appendWaitingLog(sprintf('%s left the room.', $leavingName));
            }

            $entityManager->flush();
            $entityManager->commit();
        } catch (\InvalidArgumentException $exception) {
            if ($entityManager->getConnection()->isTransactionActive()) {
                $entityManager->rollback();
            }

            return $this->fail($exception->getMessage());
        } catch (\Throwable $exception) {
            if ($entityManager->getConnection()->isTransactionActive()) {
                $entityManager->rollback();
            }

            throw $exception;
        }

        if ($roomDeleted) {
            $roomEventPublisher->publishDeleted($id);

            return $this->json(['left' => true, 'roomDeleted' => true]);
        }

        if ($game instanceof Game && $gameRealtimeEvent instanceof GameEvent) {
            $gameEventPublisher->publish($game, $gameRealtimeEvent);
        }
        $roomEventPublisher->publish($room, 'room.player.left');

        return $this->json(['left' => true, 'roomDeleted' => false]);
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

        $kickedName = $this->userDisplayName($targetPlayer->user());
        $room->removeUser($targetPlayer->user());
        $room->appendWaitingLog(sprintf('%s left the room.', $kickedName));
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

        $this->removeRoomWithGame($room, $entityManager);
        $entityManager->flush();
        $roomEventPublisher->publishDeleted($id);

        return $this->json(null, 204);
    }

    #[Route('/rooms/{id}/start', methods: ['POST'])]
    public function start(
        string $id,
        #[CurrentUser] User $user,
        EntityManagerInterface $entityManager,
        GameSnapshotFactory $snapshotFactory,
        GameProjectionService $projection,
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
        }
        if (!$room->hasResolvedTurnOrder()) {
            return $this->fail('Every player needs a unique turn-order roll before starting the game.');
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

        return $this->json([
            'room' => $room->toArray(),
            'game' => [
                ...$game->toArray(),
                'snapshot' => $projection->project($game, $user),
            ],
        ], 201);
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

    private function appendRoomSettingsLog(
        Room $room,
        int $previousMaxPlayers,
        int $previousStartingLife,
        string $previousTimerMode,
        int $previousTimerDurationSeconds,
    ): void {
        if ($room->maxPlayers() !== $previousMaxPlayers) {
            $room->appendWaitingLog(sprintf('Room size changed from %d to %d players.', $previousMaxPlayers, $room->maxPlayers()));
        }

        if ($room->startingLife() !== $previousStartingLife) {
            $delta = $room->startingLife() - $previousStartingLife;
            $room->appendWaitingLog(sprintf(
                'Starting life changed from %d to %d (%s%d life).',
                $previousStartingLife,
                $room->startingLife(),
                $delta > 0 ? '+' : '',
                $delta,
            ));
        }

        if ($room->timerMode() !== $previousTimerMode || $room->timerDurationSeconds() !== $previousTimerDurationSeconds) {
            $room->appendWaitingLog(sprintf(
                'Timer changed from %s to %s.',
                $this->timerLabel($previousTimerMode, $previousTimerDurationSeconds),
                $this->timerLabel($room->timerMode(), $room->timerDurationSeconds()),
            ));
        }
    }

    private function timerLabel(string $mode, int $durationSeconds): string
    {
        if ($mode === Room::TIMER_NONE) {
            return 'off';
        }

        $minutes = intdiv($durationSeconds, 60);
        $seconds = $durationSeconds % 60;
        $duration = $seconds === 0 ? sprintf('%d min', $minutes) : sprintf('%d:%02d', $minutes, $seconds);

        return sprintf('%s per turn', $duration);
    }

    private function userDisplayName(User $user): string
    {
        $name = trim($user->displayName());

        return $name !== '' ? $name : 'A player';
    }

    private function gameCanConcedeLeavingPlayer(Game $game, User $user): bool
    {
        if ($game->status() !== Game::STATUS_ACTIVE) {
            return false;
        }

        $player = $game->snapshot()['players'][$user->id()] ?? null;

        return is_array($player) && ($player['status'] ?? 'active') !== 'conceded';
    }

    private function gameCanRecordLeaveVote(Game $game, User $user): bool
    {
        $player = $game->snapshot()['players'][$user->id()] ?? null;
        if (!is_array($player)) {
            return false;
        }

        $vote = $game->snapshot()['rematch']['votes'][$user->id()]['vote'] ?? null;

        return $vote !== GameRematchService::VOTE_LEAVE;
    }

    private function gameHasSnapshotPlayer(Game $game, User $user): bool
    {
        return is_array($game->snapshot()['players'][$user->id()] ?? null);
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
                'displayNameStyle' => ['type' => 'plain', 'presetId' => 'plain'],
                'roles' => ['ROLE_USER'],
                'avatar' => ['type' => 'initial', 'imageUrl' => null],
            ];
        }

        return $data;
    }

    private function currentRoomSummaryArray(Room $room): array
    {
        return [
            'id' => $room->id(),
            'name' => $room->name(),
            'status' => $room->status(),
            'visibility' => $room->visibility(),
            'format' => $room->format(),
            'maxPlayers' => $room->maxPlayers(),
            'playerCount' => $room->players()->count(),
            'gameId' => $room->game()?->id(),
        ];
    }

    private function currentRoomPlayerArray(?RoomPlayer $player): ?array
    {
        if (!$player instanceof RoomPlayer) {
            return null;
        }

        $deck = $player->deck();

        return [
            'playerId' => $player->id(),
            'deckId' => $deck?->id(),
            'deckName' => $deck?->name(),
            'deckImageUrl' => $deck instanceof Deck ? $this->deckArtImageUrl($deck) : null,
        ];
    }

    private function currentRoomTurnArray(Room $room): array
    {
        $snapshotTurn = $room->game()?->snapshot()['turn'] ?? null;
        $number = is_array($snapshotTurn) && isset($snapshotTurn['number']) && is_numeric($snapshotTurn['number'])
            ? (int) $snapshotTurn['number']
            : null;

        return [
            'number' => $number,
        ];
    }

    private function currentRoomViewerRole(Room $room, User $user): string
    {
        $isOwner = $room->owner()->id() === $user->id();
        $isPlayer = $room->hasPlayer($user);

        return match (true) {
            $isOwner && $isPlayer => 'owner_player',
            $isOwner => 'owner',
            default => 'player',
        };
    }

    private function removeRoomWithGame(Room $room, EntityManagerInterface $entityManager): void
    {
        $game = $room->game();
        if ($game instanceof Game) {
            // Room and game reference each other in the database; break room.game_id first.
            $room->detachGame();
            $entityManager->flush();
            $entityManager->remove($game);
            $entityManager->flush();
        }

        $entityManager->remove($room);
    }

    private function deckArtImageUrl(Deck $deck): ?string
    {
        foreach ($deck->cards() as $deckCard) {
            if (!$deckCard instanceof DeckCard || $deckCard->section() !== DeckCard::SECTION_COMMANDER) {
                continue;
            }

            $imageUris = $deckCard->card()->imageUris();
            foreach (['art_crop', 'border_crop', 'large', 'normal'] as $format) {
                $imageUrl = $imageUris[$format] ?? null;
                if (is_string($imageUrl) && $imageUrl !== '') {
                    return $imageUrl;
                }
            }
        }

        return null;
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

    private function uniqueTurnOrderRoll(Room $room, RoomPlayer $rollingPlayer): int
    {
        $usedRolls = [];
        foreach ($room->players() as $player) {
            if (!$player instanceof RoomPlayer || $player->id() === $rollingPlayer->id() || $player->turnRoll() === null) {
                continue;
            }

            $usedRolls[(int) $player->turnRoll()] = true;
        }

        $availableRolls = array_values(array_filter(
            range(1, 20),
            static fn (int $roll): bool => !isset($usedRolls[$roll]),
        ));

        return $availableRolls[random_int(0, count($availableRolls) - 1)];
    }

    private function hasDeckIdInPayload(array $payload): bool
    {
        return isset($payload['deckId']) && is_string($payload['deckId']) && trim($payload['deckId']) !== '';
    }
}
