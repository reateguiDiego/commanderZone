<?php

namespace App\UI\Http;

use App\Domain\Message\UserMessage;
use App\Domain\User\Role;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class MessagesController extends ApiController
{
    private const MAX_SUBJECT_LENGTH = 30;
    private const MAX_BODY_LENGTH = 200000;

    #[Route('/messages', methods: ['GET'])]
    public function list(#[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $messages = $entityManager->getRepository(UserMessage::class)->createQueryBuilder('message')
            ->where('message.recipient = :recipient')
            ->setParameter('recipient', $user)
            ->orderBy('message.createdAt', 'DESC')
            ->setMaxResults(50)
            ->getQuery()
            ->getResult();

        return $this->json([
            'data' => array_map(
                static fn (UserMessage $message): array => $message->toArray(),
                array_values(array_filter($messages, static fn (mixed $message): bool => $message instanceof UserMessage)),
            ),
            'unreadCount' => $this->unreadCount($user, $entityManager),
        ]);
    }

    #[Route('/messages/{id}/read', methods: ['POST'])]
    public function markRead(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $message = $entityManager->getRepository(UserMessage::class)->find($id);
        if (!$message instanceof UserMessage || $message->recipient()->id() !== $user->id()) {
            return $this->fail('Message not found.', 404);
        }

        $message->markRead();
        $entityManager->flush();

        return $this->json([
            'message' => $message->toArray(),
            'unreadCount' => $this->unreadCount($user, $entityManager),
        ]);
    }

    #[Route('/admin/messages', methods: ['POST'])]
    public function sendAdminMessage(
        Request $request,
        #[CurrentUser] User $actor,
        EntityManagerInterface $entityManager,
    ): JsonResponse {
        if (!$actor->hasRole(Role::ADMIN) && !$actor->hasRole(Role::OWNER)) {
            return $this->fail('Admin access is required.', 403);
        }

        $payload = $this->payload($request);
        $recipientId = trim((string) ($payload['recipientId'] ?? ''));
        $subject = trim((string) ($payload['subject'] ?? ''));
        $body = trim((string) ($payload['body'] ?? ''));

        if ($recipientId === '') {
            return $this->fail('recipientId is required.');
        }
        if ($subject === '' || mb_strlen($subject) > self::MAX_SUBJECT_LENGTH) {
            return $this->fail(sprintf('Subject is required and must be %d characters or fewer.', self::MAX_SUBJECT_LENGTH));
        }
        if ($body === '' || mb_strlen($body) > self::MAX_BODY_LENGTH) {
            return $this->fail(sprintf('Message is required and must be %d characters or fewer.', self::MAX_BODY_LENGTH));
        }

        $recipients = $recipientId === 'all'
            ? $this->allUsers($entityManager)
            : $this->singleRecipient($recipientId, $entityManager);

        if ($recipients === []) {
            return $this->fail('Recipient not found.', 404);
        }

        foreach ($recipients as $recipient) {
            $entityManager->persist(new UserMessage($actor, $recipient, $subject, $body));
        }
        $entityManager->flush();

        return $this->json(['sent' => count($recipients)], 201);
    }

    /**
     * @return list<User>
     */
    private function allUsers(EntityManagerInterface $entityManager): array
    {
        $users = $entityManager->getRepository(User::class)->createQueryBuilder('user')
            ->orderBy('user.displayName', 'ASC')
            ->getQuery()
            ->getResult();

        return array_values(array_filter($users, static fn (mixed $user): bool => $user instanceof User));
    }

    /**
     * @return list<User>
     */
    private function singleRecipient(string $recipientId, EntityManagerInterface $entityManager): array
    {
        $user = $entityManager->getRepository(User::class)->find($recipientId);

        return $user instanceof User ? [$user] : [];
    }

    private function unreadCount(User $user, EntityManagerInterface $entityManager): int
    {
        return (int) $entityManager->getRepository(UserMessage::class)->createQueryBuilder('message')
            ->select('COUNT(message.id)')
            ->where('message.recipient = :recipient')
            ->andWhere('message.readAt IS NULL')
            ->setParameter('recipient', $user)
            ->getQuery()
            ->getSingleScalarResult();
    }
}
