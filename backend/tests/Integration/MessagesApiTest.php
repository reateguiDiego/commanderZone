<?php

namespace App\Tests\Integration;

use App\Domain\User\Role;

final class MessagesApiTest extends ApiTestCase
{
    public function testNewlyRegisteredUserReceivesWelcomeMessage(): void
    {
        $token = $this->registerAndLogin('welcome-message@example.test', 'Welcome Message');

        $this->jsonRequest('GET', '/messages', token: $token);

        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame(1, $response['unreadCount']);
        $message = $this->messageBySubject($response, 'Welcome');
        self::assertSame('system', $message['sender']['id']);
        self::assertSame('CommanderZone', $message['sender']['displayName']);
        self::assertStringContainsString('Welcome to CommanderZone!', $message['body']);
        self::assertStringContainsString('still under construction', $message['body']);
        self::assertStringContainsString('CommanderZone 1.0 soon', $message['body']);
        self::assertStringContainsString('[Contact](/contact)', $message['body']);
        self::assertStringContainsString('![Ms. Bumbleflower](https://api.scryfall.com/cards/blc/103?format=image&version=art_crop)', $message['body']);
        self::assertStringEndsWith('CommanderZone', $message['body']);
        self::assertNull($message['readAt']);
    }

    public function testOnlyAdminsCanSendMessages(): void
    {
        $senderToken = $this->registerAndLogin('regular-message-sender@example.test', 'Regular Sender');

        $this->jsonRequest('POST', '/admin/messages', [
            'recipientId' => 'all',
            'subject' => 'Maintenance',
            'body' => 'Table maintenance tonight.',
        ], $senderToken);

        self::assertResponseStatusCodeSame(403);
    }

    public function testAdminCanSendMessageToOneUserAndRecipientCanMarkItRead(): void
    {
        $adminToken = $this->adminToken('admin-message-sender@example.test', 'Admin Sender');
        $recipientToken = $this->registerAndLogin('message-recipient@example.test', 'Message Recipient');
        $recipientId = $this->currentUserId($recipientToken);
        $emailCountBeforeSend = count(self::getMailerMessages());

        $this->jsonRequest('POST', '/admin/messages', [
            'recipientId' => $recipientId,
            'subject' => 'Admin notice',
            'body' => 'Welcome to CommanderZone.',
            'sendEmail' => false,
        ], $adminToken);

        self::assertResponseStatusCodeSame(201);
        self::assertSame(1, $this->jsonResponse()['sent']);
        self::assertCount($emailCountBeforeSend, self::getMailerMessages());

        $this->jsonRequest('GET', '/messages', token: $recipientToken);
        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame(2, $response['unreadCount']);
        self::assertCount(2, $response['data']);
        $message = $this->messageBySubject($response, 'Admin notice');
        self::assertSame('Welcome to CommanderZone.', $message['body']);
        self::assertNull($message['readAt']);

        $messageId = (string) $message['id'];
        $this->jsonRequest('POST', '/messages/'.$messageId.'/read', token: $recipientToken);

        self::assertResponseIsSuccessful();
        self::assertSame(1, $this->jsonResponse()['unreadCount']);
        self::assertNotNull($this->jsonResponse()['message']['readAt']);
    }

    public function testAdminMessageCanAlsoBeDeliveredByEmailWithoutSkippingTheInternalMessage(): void
    {
        $adminToken = $this->adminToken('admin-email-sender@example.test', 'Admin Email Sender');
        $recipientToken = $this->registerAndLogin('email-recipient@example.test', 'Email Recipient');
        $recipientId = $this->currentUserId($recipientToken);
        $emailCountBeforeSend = count(self::getMailerMessages());

        $this->jsonRequest('POST', '/admin/messages', [
            'recipientId' => $recipientId,
            'subject' => 'Email notice',
            'body' => implode("\n", [
                '## Commander update',
                '',
                'The same message is delivered in both channels. [Open CommanderZone](/decks)',
                '',
                '- First action',
                '- [Read the guide](https://example.com/guide)',
                '',
                '---',
                '',
                '![Commander image](data:image/png;base64,aGVsbG8=)',
                '<strong>This stays text, not HTML.</strong>',
            ]),
            'sendEmail' => true,
        ], $adminToken);

        self::assertResponseStatusCodeSame(201);
        self::assertSame(1, $this->jsonResponse()['sent']);
        self::assertCount($emailCountBeforeSend + 1, self::getMailerMessages());
        $email = self::getMailerMessage($emailCountBeforeSend);
        self::assertNotNull($email);
        self::assertEmailAddressContains($email, 'To', 'email-recipient@example.test');
        self::assertEmailSubjectContains($email, 'Email notice');
        self::assertEmailTextBodyContains($email, 'The same message is delivered in both channels.');
        self::assertEmailHtmlBodyContains($email, '<h1',);
        self::assertEmailHtmlBodyContains($email, 'Email notice');
        self::assertEmailHtmlBodyContains($email, '<h2');
        self::assertEmailHtmlBodyContains($email, 'Commander update');
        self::assertEmailHtmlBodyContains($email, '<ul');
        self::assertEmailHtmlBodyContains($email, '>Open CommanderZone</a>');
        self::assertEmailHtmlBodyNotContains($email, 'href="/decks"');
        self::assertEmailHtmlBodyContains($email, 'href="https://example.com/guide"');
        self::assertEmailHtmlBodyContains($email, '<hr');
        self::assertEmailHtmlBodyContains($email, 'src="cid:admin-message-image-1@commanderzone"');
        self::assertEmailHtmlBodyContains($email, '&lt;strong&gt;This stays text, not HTML.&lt;/strong&gt;');
        self::assertEmailAttachmentCount($email, 1);

        $this->jsonRequest('GET', '/messages', token: $recipientToken);
        self::assertResponseIsSuccessful();
        self::assertStringContainsString(
            'The same message is delivered in both channels.',
            $this->messageBySubject($this->jsonResponse(), 'Email notice')['body'],
        );
    }

    public function testAdminCanSendMessageToAllUsers(): void
    {
        $adminToken = $this->adminToken('broadcast-admin@example.test', 'Broadcast Admin');
        $firstRecipient = $this->registerAndLogin('broadcast-one@example.test', 'Broadcast One');
        $secondRecipient = $this->registerAndLogin('broadcast-two@example.test', 'Broadcast Two');

        $this->jsonRequest('POST', '/admin/messages', [
            'recipientId' => 'all',
            'subject' => 'Global',
            'body' => 'This is a global message.',
        ], $adminToken);

        self::assertResponseStatusCodeSame(201);
        self::assertSame(3, $this->jsonResponse()['sent']);

        $this->jsonRequest('GET', '/messages', token: $firstRecipient);
        self::assertResponseIsSuccessful();
        self::assertSame(2, $this->jsonResponse()['unreadCount']);

        $this->jsonRequest('GET', '/messages', token: $secondRecipient);
        self::assertResponseIsSuccessful();
        self::assertSame(2, $this->jsonResponse()['unreadCount']);
    }

    public function testMessageValidationRequiresRecipientSubjectAndBody(): void
    {
        $adminToken = $this->adminToken('validation-admin@example.test', 'Validation Admin');

        $this->jsonRequest('POST', '/admin/messages', [
            'recipientId' => '',
            'subject' => '',
            'body' => '',
        ], $adminToken);

        self::assertResponseStatusCodeSame(400);
    }

    private function adminToken(string $email, string $displayName): string
    {
        $token = $this->registerAndLogin($email, $displayName);
        $this->entityManager->getConnection()->executeStatement(
            'INSERT INTO app_user_role (user_id, role_code) VALUES (:userId, :roleCode) ON CONFLICT DO NOTHING',
            ['userId' => $this->currentUserId($token), 'roleCode' => Role::ADMIN],
        );
        $this->entityManager->clear();

        return $token;
    }

    /**
     * @param array<string,mixed> $response
     * @return array<string,mixed>
     */
    private function messageBySubject(array $response, string $subject): array
    {
        $messages = $response['data'] ?? [];
        self::assertIsArray($messages);

        foreach ($messages as $message) {
            if (is_array($message) && ($message['subject'] ?? null) === $subject) {
                return $message;
            }
        }

        self::fail(sprintf('Message with subject "%s" was not found.', $subject));
    }
}
