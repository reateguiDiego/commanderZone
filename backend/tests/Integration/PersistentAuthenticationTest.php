<?php

namespace App\Tests\Integration;

use PDO;

final class PersistentAuthenticationTest extends ApiTestCase
{
    private array $previousEnvironment;

    protected function setUp(): void
    {
        $this->previousEnvironment = [$_SERVER['DATABASE_PERSISTENT'] ?? null, $_ENV['DATABASE_PERSISTENT'] ?? null, getenv('DATABASE_PERSISTENT')];
        $_SERVER['DATABASE_PERSISTENT'] = $_ENV['DATABASE_PERSISTENT'] = '1';
        putenv('DATABASE_PERSISTENT=1');
        parent::setUp();
    }

    protected function tearDown(): void
    {
        parent::tearDown();
        [$server, $env, $process] = $this->previousEnvironment;
        if ($server === null) unset($_SERVER['DATABASE_PERSISTENT']);
        else $_SERVER['DATABASE_PERSISTENT'] = $server;
        if ($env === null) unset($_ENV['DATABASE_PERSISTENT']);
        else $_ENV['DATABASE_PERSISTENT'] = $env;
        putenv($process === false ? 'DATABASE_PERSISTENT' : 'DATABASE_PERSISTENT='.$process);
    }

    public function testAlternatingUsersAndAnonymousRequestsDoNotShareAuthentication(): void
    {
        self::assertTrue($this->entityManager->getConnection()->getParams()['driverOptions'][PDO::ATTR_PERSISTENT]);
        $alice = $this->registerAndLogin('persistent-alice@example.test', 'Persistent Alice');
        $bob = $this->registerAndLogin('persistent-bob@example.test', 'Persistent Bob');
        foreach ([[$alice, 'persistent-alice@example.test'], [$bob, 'persistent-bob@example.test'], [$alice, 'persistent-alice@example.test']] as [$token, $email]) {
            $this->jsonRequest('GET', '/me', token: $token);
            self::assertResponseIsSuccessful();
            self::assertSame($email, $this->jsonResponse()['user']['email']);
        }
        $this->jsonRequest('GET', '/me');
        self::assertResponseStatusCodeSame(401);
    }
}
