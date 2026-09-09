<?php

namespace App\Tests\Infrastructure;

use App\Infrastructure\Observability\RequestPerformanceContext;
use App\Infrastructure\Observability\RequestPerformanceSubscriber;
use PHPUnit\Framework\TestCase;
use Psr\Log\AbstractLogger;
use Stringable;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\HttpKernelInterface;

final class RequestPerformanceSubscriberTest extends TestCase
{
    public function testItCorrelatesAndLogsOnlySafeRequestMetadata(): void
    {
        $logger = new class extends AbstractLogger {
            public array $records = [];
            public function log($level, Stringable|string $message, array $context = []): void { $this->records[] = [$message, $context]; }
        };
        $kernel = $this->createStub(HttpKernelInterface::class);
        $context = new RequestPerformanceContext();
        $subscriber = new RequestPerformanceSubscriber($context, $logger);
        $request = Request::create('/me?token=secret', 'GET', ['password' => 'secret'], [], [], ['HTTP_X_REQUEST_ID' => 'ci-request-1']);
        $request->attributes->set('_route', 'app_me');
        $subscriber->onRequest(new RequestEvent($kernel, $request, HttpKernelInterface::MAIN_REQUEST));
        $context->recordQuery(12.3456, 3);
        $response = new Response('{"ok":true}');
        $subscriber->onResponse(new ResponseEvent($kernel, $request, HttpKernelInterface::MAIN_REQUEST, $response));

        self::assertSame('ci-request-1', $response->headers->get('X-Request-ID'));
        self::assertSame('http_request_completed', $logger->records[0][0]);
        self::assertSame('app_me', $logger->records[0][1]['route']);
        self::assertSame(1, $logger->records[0][1]['query_count']);
        self::assertSame(3, $logger->records[0][1]['rows']);
        self::assertSame(strlen('{"ok":true}'), $logger->records[0][1]['response_bytes']);
        self::assertStringNotContainsString('secret', json_encode($logger->records, JSON_THROW_ON_ERROR));
    }
}
