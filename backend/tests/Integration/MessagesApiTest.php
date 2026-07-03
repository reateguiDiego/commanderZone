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

        $this->jsonRequest('POST', '/admin/messages', [
            'recipientId' => $recipientId,
            'subject' => 'Admin notice',
            'body' => 'Welcome to CommanderZone.',
        ], $adminToken);

        self::assertResponseStatusCodeSame(201);
        self::assertSame(1, $this->jsonResponse()['sent']);

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
