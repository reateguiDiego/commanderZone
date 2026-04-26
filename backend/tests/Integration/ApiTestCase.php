<?php

namespace App\Tests\Integration;

use App\Domain\Card\Card;
use App\Tests\Support\RecordingMercureHub;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

abstract class ApiTestCase extends WebTestCase
{
    protected KernelBrowser $client;
    protected EntityManagerInterface $entityManager;

    protected function setUp(): void
    {
        self::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->entityManager = static::getContainer()->get(EntityManagerInterface::class);
        $this->resetDatabase();
        RecordingMercureHub::reset();
    }

    protected function registerAndLogin(string $email = 'player@example.test', string $displayName = 'Player', string $password = 'password123'): string
    {
        $this->jsonRequest('POST', '/auth/register', [
            'email' => $email,
            'displayName' => $displayName,
            'password' => $password,
        ]);
        self::assertResponseStatusCodeSame(201);

        $this->jsonRequest('POST', '/auth/login', [
            'email' => $email,
            'password' => $password,
        ]);
        self::assertResponseIsSuccessful();

        return (string) $this->jsonResponse()['token'];
    }

    protected function jsonRequest(string $method, string $uri, array $payload = [], ?string $token = null): void
    {
        $headers = ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'];
        if ($token !== null) {
            $headers['HTTP_AUTHORIZATION'] = 'Bearer '.$token;
        }

        $this->client->request($method, $uri, [], [], $headers, $payload === [] ? '' : json_encode($payload, JSON_THROW_ON_ERROR));
    }

    /**
     * @return array<string,mixed>
     */
    protected function jsonResponse(): array
    {
        $decoded = json_decode($this->client->getResponse()->getContent(), true);

        self::assertIsArray($decoded);

        return $decoded;
    }

    protected function seedCard(string $scryfallId, string $name, array $overrides = []): Card
    {
        $card = new Card($scryfallId);
        $card->updateFromScryfall(array_replace([
            'id' => $scryfallId,
            'name' => $name,
            'mana_cost' => '{1}',
            'type_line' => 'Artifact',
            'oracle_text' => '',
            'colors' => [],
            'color_identity' => [],
            'legalities' => ['commander' => 'legal'],
            'image_uris' => [
                'normal' => sprintf('https://cards.scryfall.io/normal/front/%s.jpg', $scryfallId),
            ],
            'layout' => 'normal',
            'set' => 'tst',
            'collector_number' => '1',
        ], $overrides));

        $this->entityManager->persist($card);
        $this->entityManager->flush();

        return $card;
    }

    private function resetDatabase(): void
    {
        $connection = $this->entityManager->getConnection();
        \assert($connection instanceof Connection);

        $connection->executeStatement('TRUNCATE game_event, game, room_player, room, deck_card, deck, deck_folder, card, app_user RESTART IDENTITY CASCADE');
    }
}
