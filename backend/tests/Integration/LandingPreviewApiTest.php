<?php

declare(strict_types=1);

namespace App\Tests\Integration;

class LandingPreviewApiTest extends ApiTestCase
{
    public function testLandingPreviewReturnsRandomStoredCardAndUserNameWithoutAuth(): void
    {
        $this->seedCard('feedfeed-0000-7000-8000-000000000001', 'Preview Lightning');
        $this->registerAndLogin('landing-preview@example.test', 'Preview Pilot');

        $this->jsonRequest('GET', '/landing/preview');

        self::assertResponseIsSuccessful();
        self::assertSame('Preview Lightning', $this->jsonResponse()['cardName']);
        self::assertSame('Preview Pilot', $this->jsonResponse()['displayName']);
    }
}
