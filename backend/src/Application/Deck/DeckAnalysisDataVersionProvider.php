<?php

namespace App\Application\Deck;

use Doctrine\DBAL\Connection;
use Symfony\Component\Uid\Uuid;

final class DeckAnalysisDataVersionProvider
{
    public const KEY_SEMANTIC = 'semantic';
    public const KEY_COMBO = 'combo';
    public const KEY_RULES = 'rules';

    private const DEFAULT_VERSION = 'initial';

    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * @return array{semantic:string,combo:string,rules:string}
     */
    public function currentVersions(): array
    {
        return [
            self::KEY_SEMANTIC => $this->version(self::KEY_SEMANTIC),
            self::KEY_COMBO => $this->version(self::KEY_COMBO),
            self::KEY_RULES => $this->version(self::KEY_RULES),
        ];
    }

    public function touchSemantic(): string
    {
        return $this->touch(self::KEY_SEMANTIC);
    }

    public function touchCombo(): string
    {
        return $this->touch(self::KEY_COMBO);
    }

    public function touchRules(): string
    {
        return $this->touch(self::KEY_RULES);
    }

    public function version(string $key): string
    {
        $version = $this->connection->fetchOne(
            'SELECT version FROM deck_analysis_data_version WHERE key = :key',
            ['key' => $key],
        );

        return is_string($version) && trim($version) !== '' ? $version : self::DEFAULT_VERSION;
    }

    private function touch(string $key): string
    {
        $version = Uuid::v7()->toRfc4122();
        $this->connection->executeStatement(
            <<<'SQL'
INSERT INTO deck_analysis_data_version (key, version, updated_at)
VALUES (:key, :version, NOW())
ON CONFLICT (key) DO UPDATE SET
    version = EXCLUDED.version,
    updated_at = EXCLUDED.updated_at
SQL,
            [
                'key' => $key,
                'version' => $version,
            ],
        );

        return $version;
    }
}
