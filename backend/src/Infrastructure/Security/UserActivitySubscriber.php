<?php

namespace App\Infrastructure\Security;

use App\Application\Friendship\FriendPresenceService;
use App\Domain\User\User;
use App\Infrastructure\Realtime\FriendEventPublisher;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\SecurityBundle\Security;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\ControllerEvent;
use Symfony\Component\HttpKernel\KernelEvents;

class UserActivitySubscriber implements EventSubscriberInterface
{
    public function __construct(
        private readonly Security $security,
        private readonly EntityManagerInterface $entityManager,
        private readonly FriendPresenceService $presence,
        private readonly FriendEventPublisher $friendEventPublisher,
    ) {
    }

    public static function getSubscribedEvents(): array
    {
        return [
            KernelEvents::CONTROLLER => 'markCurrentUserSeen',
        ];
    }

    public function markCurrentUserSeen(ControllerEvent $event): void
    {
        if ($event->getRequest()->getPathInfo() === '/me/offline') {
            return;
        }

        $user = $this->security->getUser();
        if (!$user instanceof User) {
            return;
        }

        $previousPresence = $this->presence->statusFor($user);
        $user->markSeen();
        $this->entityManager->flush();
        if ($previousPresence !== $this->presence->statusFor($user)) {
            $this->friendEventPublisher->publishPresenceChanged($user);
        }
    }
}
