<?php

namespace App\Infrastructure\Security;

use App\Application\User\UserDailyVisitRecorder;
use App\Domain\User\User;
use Symfony\Bundle\SecurityBundle\Security;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\ControllerEvent;
use Symfony\Component\HttpKernel\KernelEvents;

final class UserDailyVisitSubscriber implements EventSubscriberInterface
{
    /**
     * @var list<string>
     */
    private const EXCLUDED_PATHS = [
        '/healthz',
        '/readyz',
        '/me/offline',
    ];

    /**
     * @var list<string>
     */
    private const EXCLUDED_PREFIXES = [
        '/_profiler',
        '/_wdt',
        '/assets',
        '/build',
    ];

    public function __construct(
        private readonly Security $security,
        private readonly UserDailyVisitRecorder $recorder,
    ) {
    }

    public static function getSubscribedEvents(): array
    {
        return [
            KernelEvents::CONTROLLER => 'recordCurrentUserDailyVisit',
        ];
    }

    public function recordCurrentUserDailyVisit(ControllerEvent $event): void
    {
        if (!$event->isMainRequest()) {
            return;
        }

        $request = $event->getRequest();
        if ($request->isMethod('OPTIONS') || $this->isExcludedPath($request->getPathInfo())) {
            return;
        }

        $user = $this->security->getUser();
        if (!$user instanceof User) {
            return;
        }

        $this->recorder->record($user, $request->getClientIp(), $request->headers->get('User-Agent'));
    }

    private function isExcludedPath(string $path): bool
    {
        if (in_array($path, self::EXCLUDED_PATHS, true)) {
            return true;
        }

        foreach (self::EXCLUDED_PREFIXES as $prefix) {
            if (str_starts_with($path, $prefix)) {
                return true;
            }
        }

        return false;
    }
}
