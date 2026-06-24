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

    protected function registerAndLogin(string $email = 'player@example.test', string $displayName = 'Player', string $password = 'Password123!'): string
    {
        $this->jsonRequest('POST', '/auth/register', [
            'email' => $email,
            'displayName' => $displayName,
            'password' => $password,
        ]);
        self::assertResponseStatusCodeSame(201);
        $registerResponse = $this->jsonResponse();
        if (isset($registerResponse['emailVerificationToken']) && is_string($registerResponse['emailVerificationToken'])) {
            $this->jsonRequest('POST', '/auth/email-verification/confirm', [
                'token' => $registerResponse['emailVerificationToken'],
            ]);
            self::assertResponseIsSuccessful();
        }

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

    protected function currentUserId(string $token): string
    {
        $this->jsonRequest('GET', '/me', token: $token);
        self::assertResponseIsSuccessful();

        return (string) $this->jsonResponse()['user']['id'];
    }

    /**
     * @param list<string> $tokens
     */
    protected function resolveTurnOrder(string $roomId, array $tokens): void
    {
        for ($attempt = 0; $attempt < 20; ++$attempt) {
            $this->jsonRequest('GET', '/rooms/'.$roomId, token: $tokens[0]);
            self::assertResponseIsSuccessful();
            $players = $this->jsonResponse()['room']['players'] ?? [];
            if ($this->turnOrderResolved($players)) {
                return;
            }

            $progress = false;
            foreach ($tokens as $token) {
                $this->jsonRequest('POST', '/rooms/'.$roomId.'/roll-turn', token: $token);
                $statusCode = $this->getClient()->getResponse()->getStatusCode();
                if ($statusCode === 200) {
                    $progress = true;
                    continue;
                }

                $response = $this->jsonResponse();
                if ($statusCode === 409 && ($response['error'] ?? '') === 'Turn order has already been rolled.') {
                    continue;
                }

                self::fail(sprintf('Unexpected turn-order response %d: %s', $statusCode, json_encode($response, JSON_THROW_ON_ERROR)));
            }

            if (!$progress) {
                break;
            }
        }

        self::fail('Unable to resolve turn order after repeated rerolls.');
    }

    /**
     * @param list<array<string,mixed>> $players
     */
    protected function turnOrderResolved(array $players): bool
    {
        $sequences = [];
        foreach ($players as $player) {
            $turnRolls = $player['turnRolls'] ?? [];
            if (!is_array($turnRolls) || $turnRolls === []) {
                return false;
            }

            $sequence = implode('-', array_map(static fn (mixed $roll): string => (string) $roll, $turnRolls));
            if (isset($sequences[$sequence])) {
                return false;
            }

            $sequences[$sequence] = true;
        }

        return $players !== [];
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
        $this->syncSeededCardPrintTables($card);

        return $card;
    }

    private function resetDatabase(): void
    {
        $connection = $this->entityManager->getConnection();
        \assert($connection instanceof Connection);
        $this->ensureCardImageStatusColumn($connection);
        $this->ensureCardHasRulingsColumn($connection);
        $this->ensureCardCatalogSearchColumns($connection);
        $this->ensureCardPrintTables($connection);
        $this->ensureRoomWaitingLogEntryTable($connection);
        $this->ensureDeckValidityColumn($connection);
        $this->ensureRoomMulliganColumns($connection);
        $this->ensureUserThemeColumn($connection);

        $tables = [
            'game_debug_health',
            'auth_request_throttle',
            'login_attempt',
            'refresh_session',
            'email_verification_token',
            'password_reset_token',
            'table_assistant_room',
            'room_invite',
            'friendship',
            'game_event',
            'game',
            'room_waiting_log_entry',
            'room_player',
            'room',
            'deck_card',
            'deck',
            'deck_folder',
            'card_print_locale',
            'card_print',
            'card',
            'app_user',
        ];
        $schemaManager = $connection->createSchemaManager();
        $existingTables = array_values(array_filter(
            $tables,
            static fn (string $table): bool => $schemaManager->tablesExist([$table]),
        ));
        if ($existingTables === []) {
            return;
        }

        $connection->executeStatement('TRUNCATE '.implode(', ', $existingTables).' RESTART IDENTITY CASCADE');
    }

    private function ensureCardImageStatusColumn(Connection $connection): void
    {
        $schemaManager = $connection->createSchemaManager();
        if (!$schemaManager->tablesExist(['card'])) {
            return;
        }

        $columns = array_map(
            static fn (\Doctrine\DBAL\Schema\Column $column): string => $column->getName(),
            $schemaManager->listTableColumns('card'),
        );
        if (in_array('image_status', $columns, true)) {
            return;
        }

        $connection->executeStatement('ALTER TABLE card ADD COLUMN image_status VARCHAR(32) DEFAULT NULL');
    }

    private function ensureCardHasRulingsColumn(Connection $connection): void
    {
        $schemaManager = $connection->createSchemaManager();
        if (!$schemaManager->tablesExist(['card'])) {
            return;
        }

        $columns = array_map(
            static fn (\Doctrine\DBAL\Schema\Column $column): string => $column->getName(),
            $schemaManager->listTableColumns('card'),
        );
        if (in_array('has_rulings', $columns, true)) {
            return;
        }

        $connection->executeStatement('ALTER TABLE card ADD COLUMN has_rulings BOOLEAN NOT NULL DEFAULT false');
    }

    private function ensureCardCatalogSearchColumns(Connection $connection): void
    {
        $schemaManager = $connection->createSchemaManager();
        if (!$schemaManager->tablesExist(['card'])) {
            return;
        }

        $columns = array_map(
            static fn (\Doctrine\DBAL\Schema\Column $column): string => $column->getName(),
            $schemaManager->listTableColumns('card'),
        );
        if (!in_array('rarity', $columns, true)) {
            $connection->executeStatement('ALTER TABLE card ADD COLUMN rarity VARCHAR(24) DEFAULT NULL');
        }
        if (!in_array('set_name', $columns, true)) {
            $connection->executeStatement('ALTER TABLE card ADD COLUMN set_name VARCHAR(255) DEFAULT NULL');
        }
    }

    private function ensureRoomWaitingLogEntryTable(Connection $connection): void
    {
        $schemaManager = $connection->createSchemaManager();
        if ($schemaManager->tablesExist(['room_waiting_log_entry']) || !$schemaManager->tablesExist(['room'])) {
            return;
        }

        $connection->executeStatement(
            <<<'SQL'
CREATE TABLE room_waiting_log_entry (
    id VARCHAR(36) NOT NULL,
    room_id VARCHAR(36) NOT NULL,
    label VARCHAR(255) NOT NULL,
    tone VARCHAR(20) NOT NULL,
    created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY(id)
)
SQL,
        );
        $connection->executeStatement('CREATE INDEX idx_room_waiting_log_room_created ON room_waiting_log_entry (room_id, created_at)');
        $connection->executeStatement(
            'ALTER TABLE room_waiting_log_entry ADD CONSTRAINT FK_ROOM_WAITING_LOG_ROOM FOREIGN KEY (room_id) REFERENCES room (id) ON DELETE CASCADE',
        );
    }

    private function ensureDeckValidityColumn(Connection $connection): void
    {
        $schemaManager = $connection->createSchemaManager();
        if (!$schemaManager->tablesExist(['deck'])) {
            return;
        }

        $columns = array_map(
            static fn (\Doctrine\DBAL\Schema\Column $column): string => $column->getName(),
            $schemaManager->listTableColumns('deck'),
        );
        if (in_array('is_valid', $columns, true)) {
            return;
        }

        $connection->executeStatement('ALTER TABLE deck ADD COLUMN is_valid BOOLEAN NOT NULL DEFAULT false');
        $connection->executeStatement('ALTER TABLE deck ALTER COLUMN is_valid DROP DEFAULT');
    }

    private function ensureRoomMulliganColumns(Connection $connection): void
    {
        $schemaManager = $connection->createSchemaManager();
        if (!$schemaManager->tablesExist(['room'])) {
            return;
        }

        $columns = array_map(
            static fn (\Doctrine\DBAL\Schema\Column $column): string => $column->getName(),
            $schemaManager->listTableColumns('room'),
        );
        if (!in_array('mulligan_rule', $columns, true)) {
            $connection->executeStatement("ALTER TABLE room ADD COLUMN mulligan_rule VARCHAR(20) NOT NULL DEFAULT 'LONDON'");
            $connection->executeStatement('ALTER TABLE room ALTER COLUMN mulligan_rule DROP DEFAULT');
        }
        if (!in_array('first_mulligan_free', $columns, true)) {
            $connection->executeStatement('ALTER TABLE room ADD COLUMN first_mulligan_free BOOLEAN NOT NULL DEFAULT true');
            $connection->executeStatement('ALTER TABLE room ALTER COLUMN first_mulligan_free DROP DEFAULT');
        }
    }

    private function ensureUserThemeColumn(Connection $connection): void
    {
        $schemaManager = $connection->createSchemaManager();
        if (!$schemaManager->tablesExist(['app_user'])) {
            return;
        }

        $columns = array_map(
            static fn (\Doctrine\DBAL\Schema\Column $column): string => $column->getName(),
            $schemaManager->listTableColumns('app_user'),
        );
        if (in_array('theme_id', $columns, true)) {
            return;
        }

        $connection->executeStatement("ALTER TABLE app_user ADD COLUMN theme_id VARCHAR(48) NOT NULL DEFAULT 'sunrise'");
        $connection->executeStatement('ALTER TABLE app_user ALTER COLUMN theme_id DROP DEFAULT');
    }

    private function ensureCardPrintTables(Connection $connection): void
    {
        $schemaManager = $connection->createSchemaManager();
        if (!$schemaManager->tablesExist(['card_print'])) {
            $connection->executeStatement(
                <<<'SQL'
CREATE TABLE card_print (
    scryfall_id VARCHAR(36) NOT NULL PRIMARY KEY,
    normalized_name VARCHAR(255) NOT NULL,
    set_code VARCHAR(16) DEFAULT NULL,
    collector_number VARCHAR(32) DEFAULT NULL,
    default_name VARCHAR(255) NOT NULL,
    default_lang VARCHAR(8) DEFAULT NULL,
    default_mana_cost VARCHAR(255) DEFAULT NULL,
    default_type_line TEXT DEFAULT NULL,
    default_oracle_text TEXT DEFAULT NULL,
    default_image_uris JSON NOT NULL,
    default_card_faces JSON NOT NULL,
    layout VARCHAR(80) NOT NULL,
    commander_legal BOOLEAN NOT NULL,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL
)
SQL,
            );
            $connection->executeStatement('CREATE INDEX idx_card_print_normalized_name ON card_print (normalized_name)');
            $connection->executeStatement('CREATE INDEX idx_card_print_set_collector ON card_print (set_code, collector_number)');
        }

        if ($schemaManager->tablesExist(['card_print_locale'])) {
            return;
        }

        $connection->executeStatement(
            <<<'SQL'
CREATE TABLE card_print_locale (
    print_scryfall_id VARCHAR(36) NOT NULL,
    lang VARCHAR(8) NOT NULL,
    name VARCHAR(255) NOT NULL,
    printed_name VARCHAR(255) DEFAULT NULL,
    mana_cost VARCHAR(255) DEFAULT NULL,
    type_line TEXT DEFAULT NULL,
    oracle_text TEXT DEFAULT NULL,
    image_uris JSON NOT NULL,
    card_faces JSON NOT NULL,
    image_status VARCHAR(32) DEFAULT NULL,
    updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    PRIMARY KEY (print_scryfall_id, lang)
)
SQL,
        );
        $connection->executeStatement('CREATE INDEX idx_card_print_locale_lang ON card_print_locale (lang)');
        $connection->executeStatement(
            'ALTER TABLE card_print_locale ADD CONSTRAINT fk_card_print_locale_print FOREIGN KEY (print_scryfall_id) REFERENCES card_print (scryfall_id) ON DELETE CASCADE',
        );
    }

    private function syncSeededCardPrintTables(Card $card): void
    {
        $connection = $this->entityManager->getConnection();
        $schemaManager = $connection->createSchemaManager();
        if (!$schemaManager->tablesExist(['card_print'])) {
            return;
        }

        $connection->executeStatement(
            <<<'SQL'
INSERT INTO card_print (
    scryfall_id,
    normalized_name,
    set_code,
    collector_number,
    default_name,
    default_lang,
    default_mana_cost,
    default_type_line,
    default_oracle_text,
    default_image_uris,
    default_card_faces,
    layout,
    commander_legal,
    updated_at
) VALUES (
    :scryfall_id,
    :normalized_name,
    :set_code,
    :collector_number,
    :default_name,
    :default_lang,
    :default_mana_cost,
    :default_type_line,
    :default_oracle_text,
    :default_image_uris,
    :default_card_faces,
    :layout,
    :commander_legal,
    NOW()
)
ON CONFLICT (scryfall_id) DO UPDATE SET
    normalized_name = EXCLUDED.normalized_name,
    set_code = EXCLUDED.set_code,
    collector_number = EXCLUDED.collector_number,
    default_name = EXCLUDED.default_name,
    default_lang = EXCLUDED.default_lang,
    default_mana_cost = EXCLUDED.default_mana_cost,
    default_type_line = EXCLUDED.default_type_line,
    default_oracle_text = EXCLUDED.default_oracle_text,
    default_image_uris = EXCLUDED.default_image_uris,
    default_card_faces = EXCLUDED.default_card_faces,
    layout = EXCLUDED.layout,
    commander_legal = EXCLUDED.commander_legal,
    updated_at = NOW()
SQL,
            [
                'scryfall_id' => $card->scryfallId(),
                'normalized_name' => Card::normalizeName($card->name()),
                'set_code' => $card->setCode(),
                'collector_number' => $card->collectorNumber(),
                'default_name' => $card->name(),
                'default_lang' => $card->lang() ?? 'en',
                'default_mana_cost' => $card->manaCost(),
                'default_type_line' => $card->typeLine(),
                'default_oracle_text' => $card->oracleText(),
                'default_image_uris' => json_encode($card->imageUris(), JSON_THROW_ON_ERROR),
                'default_card_faces' => json_encode($card->cardFaces(), JSON_THROW_ON_ERROR),
                'layout' => $card->layout(),
                'commander_legal' => $card->isCommanderLegal(),
            ],
        );

        if (!$schemaManager->tablesExist(['card_print_locale'])) {
            return;
        }

        $lang = $card->lang() ?? 'en';
        $connection->executeStatement(
            <<<'SQL'
INSERT INTO card_print_locale (
    print_scryfall_id,
    lang,
    name,
    printed_name,
    mana_cost,
    type_line,
    oracle_text,
    image_uris,
    card_faces,
    image_status,
    updated_at
) VALUES (
    :print_scryfall_id,
    :lang,
    :name,
    :printed_name,
    :mana_cost,
    :type_line,
    :oracle_text,
    :image_uris,
    :card_faces,
    :image_status,
    NOW()
)
ON CONFLICT (print_scryfall_id, lang) DO UPDATE SET
    name = EXCLUDED.name,
    printed_name = EXCLUDED.printed_name,
    mana_cost = EXCLUDED.mana_cost,
    type_line = EXCLUDED.type_line,
    oracle_text = EXCLUDED.oracle_text,
    image_uris = EXCLUDED.image_uris,
    card_faces = EXCLUDED.card_faces,
    image_status = EXCLUDED.image_status,
    updated_at = NOW()
SQL,
            [
                'print_scryfall_id' => $card->scryfallId(),
                'lang' => $lang,
                'name' => $card->name(),
                'printed_name' => $card->printedName(),
                'mana_cost' => $card->manaCost(),
                'type_line' => $card->typeLine(),
                'oracle_text' => $card->oracleText(),
                'image_uris' => json_encode($card->imageUris(), JSON_THROW_ON_ERROR),
                'card_faces' => json_encode($card->cardFaces(), JSON_THROW_ON_ERROR),
                'image_status' => $card->imageStatus(),
            ],
        );
    }
}
