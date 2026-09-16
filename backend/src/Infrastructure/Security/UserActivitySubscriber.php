<?php

namespace App\Infrastructure\Security;

use App\Application\Friendship\FriendPresenceService;
use App\Application\User\UserActivityRecorder;
use App\Domain\User\User;
use App\Infrastructure\Realtime\FriendEventPublisher;
use Symfony\Component\Clock\ClockInterface;
use Symfony\Bundle\SecurityBundle\Security;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\ControllerEvent;
use Symfony\Component\HttpKernel\KernelEvents;

class UserActivitySubscriber implements EventSubscriberInterface
{
    public function __construct(
        private readonly Security $security,
        private readonly UserActivityRecorder $activity,
        private readonly ClockInterface $clock,
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
        if (!$event->isMainRequest()) {
            return;
        }
        if (in_array($event->getRequest()->attributes->get('_route'), ['rooms.presence'], true)
            || $event->getRequest()->getPathInfo() === '/me/offline') {
            return;
        }

        $user = $this->security->getUser();
        if (!$user instanceof User) {
            return;
        }

        $wasOffline = $user->lastSeenAt() === null
            || $user->lastSeenAt() < $this->clock->now()->modify('-'.FriendPresenceService::ONLINE_WINDOW_SECONDS.' seconds');
        if ($this->activity->record($user) && $wasOffline) {
            $this->friendEventPublisher->publishPresenceChanged($user);
        }
    }
}
