<?php

namespace App\Tests\UI\Http;

use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

final class HealthEndpointTest extends WebTestCase
{
    public function testHealthzIsPublic(): void
    {
        self::ensureKernelShutdown();
        $client = static::createClient();
        $client->request('GET', '/healthz');

        self::assertResponseIsSuccessful();
        self::assertJsonStringEqualsJsonString('{"status":"ok"}', $client->getResponse()->getContent() ?: '');
    }

    public function testReadyzIsPublic(): void
    {
        self::ensureKernelShutdown();
        $client = static::createClient();
        $client->request('GET', '/readyz');

        self::assertResponseIsSuccessful();
        self::assertJsonStringEqualsJsonString('{"status":"ready"}', $client->getResponse()->getContent() ?: '');
    }
}
