<?php

namespace App\Tests\UI\Http;

use App\UI\Http\HealthController;
use PHPUnit\Framework\TestCase;

final class HealthControllerTest extends TestCase
{
    public function testHealthzReturnsOk(): void
    {
        $response = (new HealthController())->healthz();
        $payload = json_decode($response->getContent() ?: '[]', true, flags: JSON_THROW_ON_ERROR);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(['status' => 'ok'], $payload);
    }

    public function testReadyzReturnsReady(): void
    {
        $response = (new HealthController())->readyz();
        $payload = json_decode($response->getContent() ?: '[]', true, flags: JSON_THROW_ON_ERROR);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(['status' => 'ready'], $payload);
    }
}
