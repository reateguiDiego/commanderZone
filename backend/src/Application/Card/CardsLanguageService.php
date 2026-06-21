<?php

namespace App\Application\Card;

use App\Domain\Localization\LanguageCatalog;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;

final readonly class CardsLanguageService
{
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

    public function __construct(private Connection $connection)
    {
    }

    /**
     * @return list<array{code:string,label:string,distinctCardNames:int,percentageOfEnglish:float}>
     */
    public function languageCoverage(): array
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
