<?php

namespace App\Infrastructure\Observability;

use Psr\Log\LoggerInterface;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Component\Uid\Uuid;

final readonly class RequestPerformanceSubscriber implements EventSubscriberInterface
{
    private const START_ATTRIBUTE = '_cz_request_started_at';
    private const ID_ATTRIBUTE = '_cz_request_id';

    public function __construct(
        private RequestPerformanceContext $context,
        private LoggerInterface $logger,
    ) {
    }

    public static function getSubscribedEvents(): array
    {
        return [KernelEvents::REQUEST => ['onRequest', 2048], KernelEvents::RESPONSE => ['onResponse', -2048]];
    }

    public function onRequest(RequestEvent $event): void
    {
        if (!$event->isMainRequest()) return;
        $request = $event->getRequest();
        $requestId = $this->requestId($request);
        $request->attributes->set(self::START_ATTRIBUTE, hrtime(true));
        $request->attributes->set(self::ID_ATTRIBUTE, $requestId);
        $this->context->reset();
    }

    public function onResponse(ResponseEvent $event): void
    {
        if (!$event->isMainRequest()) return;
        $request = $event->getRequest();
        $response = $event->getResponse();
        $requestId = (string) $request->attributes->get(self::ID_ATTRIBUTE, Uuid::v7()->toRfc4122());
        $response->headers->set('X-Request-ID', $requestId);
        $startedAt = (int) $request->attributes->get(self::START_ATTRIBUTE, hrtime(true));
        $content = $response->getContent();

        $this->logger->info('http_request_completed', array_merge($this->context->metrics(), [
            'request_id' => $requestId,
            'method' => $request->getMethod(),
            'route' => (string) $request->attributes->get('_route', 'unmatched'),
            'status' => $response->getStatusCode(),
            'duration_ms' => round((hrtime(true) - $startedAt) / 1_000_000, 3),
            'response_bytes' => is_string($content) ? strlen($content) : 0,
        ]));
    }

    private function requestId(Request $request): string
    {
        $provided = $request->headers->get('X-Request-ID', '');
        return preg_match('/^[A-Za-z0-9._-]{1,128}$/D', $provided) === 1 ? $provided : Uuid::v7()->toRfc4122();
    }
}
