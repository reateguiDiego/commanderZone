<?php

namespace App\UI\Http;

use App\Application\TableAssistant\TableAssistantCommandHandler;
use App\Application\TableAssistant\TableAssistantStateFactory;
use App\Domain\Room\Room;
use App\Domain\Room\RoomInvite;
use App\Domain\Room\RoomPlayer;
use App\Domain\TableAssistant\TableAssistantRoom;
use App\Domain\User\User;
use App\Infrastructure\Realtime\TableAssistantEventPublisher;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class TableAssistantRoomsController extends ApiController
{
    #[Route('/table-assistant/rooms', methods: ['POST'])]
    public function create(
        Request $request,
        #[CurrentUser] User $user,
        EntityManagerInterface $entityManager,
        TableAssistantStateFactory $stateFactory,
        TableAssistantEventPublisher $publisher,
    ): JsonResponse {
        $payload = $this->payload($request);
        $room = new Room($user);
        $room->setVisibility(Room::VISIBILITY_PRIVATE);
        $room->addPlayer(new RoomPlayer($room, $user));

        $assistantRoom = new TableAssistantRoom($room, $stateFactory->create($room, $user, $payload));

        $entityManager->persist($room);
        $entityManager->persist($assistantRoom);
        $entityManager->flush();
        $publisher->publish($assistantRoom, 'room.created');

        return $this->json(['tableAssistantRoom' => $assistantRoom->toArray()], 201);
    }

    #[Route('/table-assistant/rooms/{id}', methods: ['GET'])]
    public function show(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $assistantRoom = $this->assistantRoom($id, $entityManager);
        if (!$assistantRoom instanceof TableAssistantRoom) {
            return $this->fail('Table assistant room not found.', 404);
        }
        $isInvited = $this->isInvitedToRoom($assistantRoom->room(), $user, $entityManager);
        if (!$assistantRoom->room()->canBeViewedBy($user, $isInvited)) {
            return $this->fail('Table assistant room access denied.', 403);
        }

        return $this->json(['tableAssistantRoom' => $assistantRoom->toArray()]);
    }

    #[Route('/table-assistant/rooms/{id}/join', methods: ['POST'])]
    public function join(
        string $id,
        Request $request,
        #[CurrentUser] User $user,
        EntityManagerInterface $entityManager,
        TableAssistantCommandHandler $commandHandler,
        TableAssistantEventPublisher $publisher,
    ): JsonResponse {
        $assistantRoom = $this->assistantRoom($id, $entityManager);
        if (!$assistantRoom instanceof TableAssistantRoom) {
            return $this->fail('Table assistant room not found.', 404);
        }
        if ($assistantRoom->room()->status() !== Room::STATUS_WAITING) {
            return $this->fail('Table assistant room is closed.', 409);
        }

        $assistantRoom->room()->addPlayer(new RoomPlayer($assistantRoom->room(), $user));
        $payload = $this->payload($request);
        $deviceId = is_string($payload['deviceId'] ?? null) ? trim($payload['deviceId']) : null;
        $commandHandler->addParticipant($assistantRoom, $user, $deviceId ?: null);

        $entityManager->flush();
        $publisher->publish($assistantRoom, 'participant.joined', ['userId' => $user->id()]);

        return $this->json(['tableAssistantRoom' => $assistantRoom->toArray()]);
    }

    #[Route('/table-assistant/rooms/{id}/actions', methods: ['POST'])]
    public function action(
        string $id,
        Request $request,
        #[CurrentUser] User $user,
        EntityManagerInterface $entityManager,
        TableAssistantCommandHandler $commandHandler,
        TableAssistantEventPublisher $publisher,
    ): JsonResponse {
        $assistantRoom = $this->assistantRoom($id, $entityManager);
        if (!$assistantRoom instanceof TableAssistantRoom) {
            return $this->fail('Table assistant room not found.', 404);
        }

        $payload = $this->payload($request);
        $type = is_string($payload['type'] ?? null) ? trim($payload['type']) : '';
        $actionPayload = is_array($payload['payload'] ?? null) ? $payload['payload'] : [];
        $clientActionId = is_string($payload['clientActionId'] ?? null) && trim($payload['clientActionId']) !== ''
            ? trim($payload['clientActionId'])
            : null;

        if ($type === '') {
            return $this->fail('type is required.');
        }

        try {
            $applied = $commandHandler->apply($assistantRoom, $type, $actionPayload, $user, $clientActionId);
        } catch (\InvalidArgumentException $exception) {
            return $this->fail($exception->getMessage(), 422);
        }

        $entityManager->flush();
        if ($applied) {
            $publisher->publish($assistantRoom, 'action.applied', ['type' => $type, 'clientActionId' => $clientActionId]);
        }

        return $this->json(['tableAssistantRoom' => $assistantRoom->toArray(), 'applied' => $applied]);
    }

    private function assistantRoom(string $roomId, EntityManagerInterface $entityManager): ?TableAssistantRoom
    {
        $room = $entityManager->getRepository(Room::class)->find($roomId);
        if (!$room instanceof Room) {
            return null;
        }

        return $entityManager->getRepository(TableAssistantRoom::class)->findOneBy(['room' => $room]);
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
}
