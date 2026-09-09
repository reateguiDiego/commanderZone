<?php

namespace App\UI\Http;

use App\Application\Message\AdminMessageMailer;
use App\Application\Message\AdminMessageDelivery;
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
    private const RECIPIENT_NEVER_CONNECTED = 'never_connected';
    private const RECIPIENT_RECENTLY_CONNECTED = 'recently_connected';
    private const RECIPIENT_RECENTLY_CREATED = 'recently_created';
    private const RECIPIENT_TIER_0 = 'tier_0';
    private const RECIPIENT_TIER_1 = 'tier_1';
    private const RECIPIENT_TIER_2 = 'tier_2';
    private const RECIPIENT_TIER_3 = 'tier_3';

    /** @var array<string, string> */
    private const RECIPIENT_TIER_MAP = [
        self::RECIPIENT_TIER_0 => User::PREMIUM_TIER_NONE,
        self::RECIPIENT_TIER_1 => User::PREMIUM_TIER_1,
        self::RECIPIENT_TIER_2 => User::PREMIUM_TIER_2,
        self::RECIPIENT_TIER_3 => User::PREMIUM_TIER_3,
    ];

    public function __construct(private readonly AdminMessageMailer $adminMessageMailer)
    {
    }

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
        $delivery = $payload['delivery'] ?? null;

        if ($recipientId === '') {
            return $this->fail('recipientId is required.');
        }
        if ($subject === '' || mb_strlen($subject) > self::MAX_SUBJECT_LENGTH) {
            return $this->fail(sprintf('Subject is required and must be %d characters or fewer.', self::MAX_SUBJECT_LENGTH));
        }
        if ($body === '' || mb_strlen($body) > self::MAX_BODY_LENGTH) {
            return $this->fail(sprintf('Message is required and must be %d characters or fewer.', self::MAX_BODY_LENGTH));
        }
        if ($delivery === null) {
            $legacySendEmail = $payload['sendEmail'] ?? false;
            if (!is_bool($legacySendEmail)) {
                return $this->fail('sendEmail must be a boolean.');
            }

            $delivery = $legacySendEmail ? AdminMessageDelivery::Both : AdminMessageDelivery::Internal;
        } elseif (!is_string($delivery) || ($delivery = AdminMessageDelivery::tryFrom($delivery)) === null) {
            return $this->fail('delivery must be one of: internal, email, both.');
        }

        if ($recipientId === 'all') {
            $recipients = $this->allUsers($entityManager);
        } else {
            $recipients = $this->segmentRecipients($recipientId, $entityManager)
                ?? $this->singleRecipient($recipientId, $entityManager);
        }

        if ($recipients === []) {
            return $this->fail('Recipient not found.', 404);
        }

        if ($delivery->sendsInternalMessage()) {
            foreach ($recipients as $recipient) {
                $entityManager->persist(new UserMessage($actor, $recipient, $subject, $body));
            }
            $entityManager->flush();
        }

        if ($delivery->sendsEmail()) {
            foreach ($recipients as $recipient) {
                $this->adminMessageMailer->send($recipient, $subject, $body);
            }
        }

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

    /**
     * @return list<User>|null Null when the recipient is not a predefined segment.
     */
    private function segmentRecipients(string $recipientId, EntityManagerInterface $entityManager): ?array
    {
        $queryBuilder = $entityManager->getRepository(User::class)->createQueryBuilder('user')
            ->orderBy('user.displayName', 'ASC');

        if ($recipientId === self::RECIPIENT_NEVER_CONNECTED) {
            $queryBuilder->where('user.lastSeenAt IS NULL');
        } elseif ($recipientId === self::RECIPIENT_RECENTLY_CONNECTED) {
            $now = new \DateTimeImmutable();
            $queryBuilder
                ->where('user.lastSeenAt >= :recentSince')
                ->andWhere('user.lastSeenAt <= :now')
                ->setParameter('recentSince', $now->modify('-7 days'))
                ->setParameter('now', $now);
        } elseif ($recipientId === self::RECIPIENT_RECENTLY_CREATED) {
            $now = new \DateTimeImmutable();
            $queryBuilder
                ->where('user.createdAt >= :recentSince')
                ->andWhere('user.createdAt <= :now')
                ->setParameter('recentSince', $now->modify('-7 days'))
                ->setParameter('now', $now);
        } elseif (isset(self::RECIPIENT_TIER_MAP[$recipientId])) {
            $queryBuilder
                ->where('user.premiumTier = :premiumTier')
                ->setParameter('premiumTier', self::RECIPIENT_TIER_MAP[$recipientId]);
        } else {
            return null;
        }

        $users = $queryBuilder->getQuery()->getResult();

        return array_values(array_filter($users, static fn (mixed $user): bool => $user instanceof User));
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
