<?php

namespace App\Application\Card;

use App\Domain\Localization\LanguageCatalog;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Contracts\Cache\CacheInterface;
use Symfony\Contracts\Cache\ItemInterface;

final readonly class CardsLanguageService
{
    private const COVERAGE_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
    private const LANGUAGE_LABELS = [
        'en' => 'Ingles',
        'fr' => 'Frances',
        'de' => 'Aleman',
        'it' => 'Italiano',
        'es' => 'Espanol',
        'ja' => 'Japones',
        'zhs' => 'Chino simplificado',
        'pt' => 'Portugues',
        'ru' => 'Ruso',
        'ko' => 'Coreano',
        'zht' => 'Chino tradicional',
        'nl' => 'Holandes',
        'ca' => 'Catalan',
    ];

    public function __construct(
        private Connection $connection,
        private CacheInterface $cache,
        #[Autowire('%kernel.environment%')]
        private string $environment,
    )
    {
    }

    /**
     * @return list<array{code:string,label:string,distinctCardNames:int,percentageOfEnglish:float}>
     */
    public function languageCoverage(): array
    {
        if ($this->environment === 'test') {
            return $this->resolveLanguageCoverage();
        }

        return $this->cache->get(
            'cards.languages.coverage.'.$this->coverageCacheSignature(),
            function (ItemInterface $item): array {
                $item->expiresAfter(self::COVERAGE_CACHE_TTL_SECONDS);

                return $this->resolveLanguageCoverage();
            },
        );
    }

    /**
     * @return list<array{code:string,label:string,distinctCardNames:int,percentageOfEnglish:float}>
     */
    private function resolveLanguageCoverage(): array
    {
        $rows = $this->connection->executeQuery(
            <<<'SQL'
SELECT
    lang,
    COUNT(DISTINCT COALESCE(NULLIF(BTRIM(printed_name), ''), BTRIM(name))) AS distinct_card_names
FROM card_print_locale
WHERE lang IS NOT NULL
  AND lang NOT IN (:commonPrintLanguages)
GROUP BY lang
ORDER BY distinct_card_names DESC, lang ASC
SQL,
            ['commonPrintLanguages' => LanguageCatalog::commonPrintLanguages()],
            ['commonPrintLanguages' => ArrayParameterType::STRING],
        )->fetchAllAssociative();

        $englishCount = $this->englishCount($rows);

        return array_map(
            fn (array $row): array => $this->coverageRow($row, $englishCount),
            $rows,
        );
    }

    private function coverageCacheSignature(): string
    {
        $row = $this->connection->executeQuery(
            <<<'SQL'
SELECT
    COUNT(*) AS total_rows,
    COALESCE(MAX(updated_at), TIMESTAMP '1970-01-01 00:00:00') AS last_updated_at
FROM card_print_locale
WHERE lang IS NOT NULL
  AND lang NOT IN (:commonPrintLanguages)
SQL,
            ['commonPrintLanguages' => LanguageCatalog::commonPrintLanguages()],
            ['commonPrintLanguages' => ArrayParameterType::STRING],
        )->fetchAssociative();

        $signaturePayload = [
            'rows' => (int) ($row['total_rows'] ?? 0),
            'updatedAt' => (string) ($row['last_updated_at'] ?? '1970-01-01 00:00:00'),
        ];

        return hash('xxh128', json_encode($signaturePayload, JSON_THROW_ON_ERROR));
    }

    /**
     * @param list<array<string,mixed>> $rows
     */
    private function englishCount(array $rows): int
    {
        foreach ($rows as $row) {
            if (($row['lang'] ?? null) === LanguageCatalog::DEFAULT_LANGUAGE) {
                return (int) ($row['distinct_card_names'] ?? 0);
            }
        }

        return 0;
    }

    /**
     * @param array<string,mixed> $row
     *
     * @return array{code:string,label:string,distinctCardNames:int,percentageOfEnglish:float}
     */
    private function coverageRow(array $row, int $englishCount): array
    {
        $code = (string) ($row['lang'] ?? '');
        $count = (int) ($row['distinct_card_names'] ?? 0);

        return [
            'code' => $code,
            'label' => self::LANGUAGE_LABELS[$code] ?? $code,
            'distinctCardNames' => $count,
            'percentageOfEnglish' => $englishCount > 0 ? round(($count / $englishCount) * 100, 2) : 0.0,
        ];
    }
}
