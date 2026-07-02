<?php

namespace App\Tests\Integration;

use App\Domain\User\Role;

final class MessagesApiTest extends ApiTestCase
{
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
            'subject' => 'Welcome',
            'body' => 'Welcome to CommanderZone.',
        ], $adminToken);

        self::assertResponseStatusCodeSame(201);
        self::assertSame(1, $this->jsonResponse()['sent']);

        $this->jsonRequest('GET', '/messages', token: $recipientToken);
        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame(1, $response['unreadCount']);
        self::assertCount(1, $response['data']);
        self::assertSame('Welcome', $response['data'][0]['subject']);
        self::assertSame('Welcome to CommanderZone.', $response['data'][0]['body']);
        self::assertNull($response['data'][0]['readAt']);

        $messageId = (string) $response['data'][0]['id'];
        $this->jsonRequest('POST', '/messages/'.$messageId.'/read', token: $recipientToken);

        self::assertResponseIsSuccessful();
        self::assertSame(0, $this->jsonResponse()['unreadCount']);
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
        self::assertSame(1, $this->jsonResponse()['unreadCount']);

        $this->jsonRequest('GET', '/messages', token: $secondRecipient);
        self::assertResponseIsSuccessful();
        self::assertSame(1, $this->jsonResponse()['unreadCount']);
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
}
