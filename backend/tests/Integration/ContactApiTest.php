<?php

namespace App\Tests\Integration;

use App\Application\Contact\ContactMailer;

class ContactApiTest extends ApiTestCase
{
    public function testContactRequestIsPublicAndAccepted(): void
    {
        $mailer = $this->getMockBuilder(ContactMailer::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['send'])
            ->getMock();
        $mailer
            ->expects(self::once())
            ->method('send')
            ->with('Player One', 'player@example.test', 'Bug report', 'Something went wrong.');

        static::getContainer()->set(ContactMailer::class, $mailer);

        $this->jsonRequest('POST', '/contact', [
            'name' => 'Player One',
            'email' => 'player@example.test',
            'subject' => 'Bug report',
            'message' => 'Something went wrong.',
        ]);

        self::assertResponseStatusCodeSame(202);
        self::assertTrue($this->jsonResponse()['accepted']);
    }

    public function testContactRejectsInvalidPayload(): void
    {
        $this->jsonRequest('POST', '/contact', [
            'name' => '',
            'email' => 'invalid-email',
            'subject' => '',
            'message' => '',
        ]);

        self::assertResponseStatusCodeSame(400);
        self::assertSame('name, email, subject and message are required and must be valid.', $this->jsonResponse()['error']);
    }

    public function testContactIsThrottledByIpAndEmail(): void
    {
        $mailer = $this->getMockBuilder(ContactMailer::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['send'])
            ->getMock();
        $mailer
            ->expects(self::once())
            ->method('send');

        static::getContainer()->set(ContactMailer::class, $mailer);

        for ($attempt = 0; $attempt < 3; ++$attempt) {
            $this->jsonRequest('POST', '/contact', [
                'name' => 'Player One',
                'email' => 'player@example.test',
                'subject' => sprintf('Bug report %d', $attempt),
                'message' => 'Something went wrong.',
            ]);
            self::assertResponseStatusCodeSame(202);
        }

        $this->jsonRequest('POST', '/contact', [
            'name' => 'Player One',
            'email' => 'player@example.test',
            'subject' => 'Bug report 4',
            'message' => 'Something went wrong.',
        ]);

        self::assertResponseStatusCodeSame(429);
        self::assertSame('Too many contact requests. Please try again later.', $this->jsonResponse()['error']);
        self::assertGreaterThan(0, $this->jsonResponse()['retryAfterSeconds']);
        self::assertSame((string) $this->jsonResponse()['retryAfterSeconds'], static::getClient()->getResponse()->headers->get('Retry-After'));
    }

    public function testContactReturnsVisibleErrorWhenMailerFails(): void
    {
        $mailer = $this->getMockBuilder(ContactMailer::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['send'])
            ->getMock();
        $mailer
            ->expects(self::once())
            ->method('send')
            ->willThrowException(new \RuntimeException('smtp offline'));

        static::getContainer()->set(ContactMailer::class, $mailer);

        $this->jsonRequest('POST', '/contact', [
            'name' => 'Player One',
            'email' => 'player@example.test',
            'subject' => 'Bug report',
            'message' => 'Something went wrong.',
        ]);

        self::assertResponseStatusCodeSame(503);
        self::assertSame('We could not send your message right now. Please try again later.', $this->jsonResponse()['error']);
    }
}
