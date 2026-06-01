<?php

namespace App\Tests\Integration;

class CorsApiTest extends ApiTestCase
{
    public function testApiErrorResponsesKeepCorsHeaders(): void
    {
        $token = $this->registerAndLogin('cors-error@example.test', 'Cors Error');

        $this->client->request('GET', '/rooms?status=unsupported', [], [], [
            'HTTP_ACCEPT' => 'application/json',
            'HTTP_AUTHORIZATION' => 'Bearer '.$token,
            'HTTP_ORIGIN' => 'http://localhost:4200',
        ]);

        self::assertResponseStatusCodeSame(400);
        self::assertSame('http://localhost:4200', $this->client->getResponse()->headers->get('Access-Control-Allow-Origin'));
        self::assertSame('true', $this->client->getResponse()->headers->get('Access-Control-Allow-Credentials'));
    }
}
