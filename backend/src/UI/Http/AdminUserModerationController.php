<?php

declare(strict_types=1);

namespace App\UI\Http;

use App\Application\Moderation\ModerationNotFoundException;
use App\Application\Moderation\ModerationPermissionPolicy;
use App\Application\Moderation\ModerationStrikeService;
use App\Application\Moderation\ModerationValidationException;
use App\Domain\Message\UserMessage;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class AdminUserModerationController extends ApiController
{
    #[Route('/admin/users/{id}/moderation', methods: ['GET'])]
    public function detail(
        string $id,
        #[CurrentUser] User $actor,
        EntityManagerInterface $entityManager,
        ModerationPermissionPolicy $permissions,
        ModerationStrikeService $strikes,
    ): JsonResponse {
        if (!$permissions->canAccessModeration($actor)) {
            return $this->fail('Admin access is required.', 403);
        }
        $target = $this->target($id, $entityManager);
        if (!$target instanceof User) {
            return $this->fail('User not found.', 404);
        }
        if (!$permissions->canReviewTarget($actor, $target)) {
            return $this->fail('You cannot access moderation details for this user.', 403);
        }

        return $this->json([
            'user' => $this->profile($target),
            'strikes' => array_map(static fn ($strike): array => $strike->toAdminArray(), $strikes->strikesFor($target)),
        ]);
    }

    #[Route('/admin/users/{id}/moderation/messages', methods: ['GET'])]
    public function messages(
        string $id,
        #[CurrentUser] User $actor,
        EntityManagerInterface $entityManager,
        ModerationPermissionPolicy $permissions,
    ): JsonResponse {
        if (!$permissions->canAccessModeration($actor)) {
            return $this->fail('Admin access is required.', 403);
        }
        $target = $this->target($id, $entityManager);
        if (!$target instanceof User) {
            return $this->fail('User not found.', 404);
        }
        if (!$permissions->canReviewTarget($actor, $target)) {
            return $this->fail('You cannot access moderation details for this user.', 403);
        }

        $messages = $entityManager->getRepository(UserMessage::class)->createQueryBuilder('message')
            ->leftJoin('message.sender', 'sender')
            ->addSelect('sender')
            ->where('message.recipient = :recipient')
            ->setParameter('recipient', $target)
            ->orderBy('message.createdAt', 'DESC')
            ->addOrderBy('message.id', 'DESC')
            ->getQuery()
            ->getResult();

        return $this->json([
            'messages' => array_map(
                static fn (UserMessage $message): array => $message->toArray(),
                array_values(array_filter($messages, static fn (mixed $message): bool => $message instanceof UserMessage)),
            ),
        ]);
    }

    #[Route('/admin/users/{id}/strikes', methods: ['POST'])]
    public function issueStrike(
        string $id,
        Request $request,
        #[CurrentUser] User $actor,
        EntityManagerInterface $entityManager,
        ModerationPermissionPolicy $permissions,
        ModerationStrikeService $strikes,
    ): JsonResponse {
        if (!$permissions->canAccessModeration($actor)) {
            return $this->fail('Admin access is required.', 403);
        }
        $target = $this->target($id, $entityManager);
        if (!$target instanceof User) {
            return $this->fail('User not found.', 404);
        }
        $description = $this->payload($request)['description'] ?? null;
        if (!is_string($description)) {
            return $this->fail('Strike description is required.');
        }

        try {
            $strike = $strikes->issue($actor, $target, $description);
        } catch (ModerationValidationException|\InvalidArgumentException $exception) {
            return $this->fail($exception->getMessage());
        }

        return $this->json([
            'strike' => $strike->toAdminArray(),
            'strikesCount' => $target->strikesCount(),
        ], 201);
    }

    #[Route('/admin/users/{id}/strikes/{strikeId}', methods: ['DELETE'])]
    public function deleteStrike(
        string $id,
        string $strikeId,
        #[CurrentUser] User $actor,
        EntityManagerInterface $entityManager,
        ModerationPermissionPolicy $permissions,
        ModerationStrikeService $strikes,
    ): JsonResponse {
        if (!$permissions->canAccessModeration($actor)) {
            return $this->fail('Admin access is required.', 403);
        }
        $target = $this->target($id, $entityManager);
        if (!$target instanceof User) {
            return $this->fail('User not found.', 404);
        }

        try {
            $strikes->delete($actor, $target, $strikeId);
        } catch (ModerationNotFoundException $exception) {
            return $this->fail($exception->getMessage(), 404);
        } catch (ModerationValidationException $exception) {
            return $this->fail($exception->getMessage(), 403);
        }

        return $this->json([
            'strike' => null,
            'strikesCount' => $target->strikesCount(),
        ]);
    }

    private function target(string $id, EntityManagerInterface $entityManager): ?User
    {
        $user = $entityManager->find(User::class, $id);

        return $user instanceof User ? $user : null;
    }

    /** @return array<string,mixed> */
    private function profile(User $user): array
    {
        return [
            'id' => $user->id(),
            'displayName' => $user->displayName(),
            'roles' => $user->getRoles(),
            ...$user->moderationCounters(),
        ];
    }
}
