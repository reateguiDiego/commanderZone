<?php

namespace App\Tests\Application\GameWebSocket;

use App\Application\Game\WebSocket\GameWebsocketCardLocalizationResolver;
use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Result;
use PHPUnit\Framework\TestCase;

class GameWebsocketCardLocalizationResolverTest extends TestCase
{
    public function testSelectsExactRequestedPrintWhenUsable(): void
    {
        $resolver = $this->resolverWithRows(
            sources: [$this->sourceRow()],
            candidates: [
                $this->candidateRow(sourceScryfallId: 'source-1', candidateScryfallId: 'es-cmm-1', lang: 'es', imageStatus: null),
                $this->candidateRow(sourceScryfallId: 'source-1', candidateScryfallId: 'en-cmm-1', lang: 'en', imageStatus: null),
            ],
            payloads: [
                $this->payloadRow(scryfallId: 'es-cmm-1', lang: 'es', printedName: 'Anillo solar'),
                $this->payloadRow(scryfallId: 'en-cmm-1', lang: 'en', printedName: null),
            ],
        );

        $lookup = $resolver->buildLocalizedLookup($this->snapshotWithCard('source-1'), [], ['es']);

        self::assertSame('Anillo solar', $lookup['es']['source-1']['name']);
        self::assertSame('es', $lookup['es']['source-1']['lang']);
    }

    public function testFallsBackToExactEnglishWhenRequestedExactPrintIsUnavailable(): void
    {
        $resolver = $this->resolverWithRows(
            sources: [$this->sourceRow()],
            candidates: [
                $this->candidateRow(sourceScryfallId: 'source-1', candidateScryfallId: 'es-cmm-1', lang: 'es', imageStatus: 'placeholder'),
                $this->candidateRow(sourceScryfallId: 'source-1', candidateScryfallId: 'en-cmm-1', lang: 'en', imageStatus: null),
            ],
            payloads: [
                $this->payloadRow(scryfallId: 'en-cmm-1', lang: 'en', printedName: null),
            ],
        );

        $lookup = $resolver->buildLocalizedLookup($this->snapshotWithCard('source-1'), [], ['es']);

        self::assertSame('Sol Ring', $lookup['es']['source-1']['name']);
        self::assertSame('en', $lookup['es']['source-1']['lang']);
    }

    public function testFallsBackToEnglishWhenRequestedLanguageRowsAreUnavailable(): void
    {
        $resolver = $this->resolverWithRows(
            sources: [$this->sourceRow()],
            candidates: [
                $this->candidateRow(sourceScryfallId: 'source-1', candidateScryfallId: 'es-cmm-1', lang: 'es', imageStatus: 'missing'),
                $this->candidateRow(sourceScryfallId: 'source-1', candidateScryfallId: 'en-cmm-1', lang: 'en', imageStatus: null),
            ],
            payloads: [
                $this->payloadRow(scryfallId: 'en-cmm-1', lang: 'en', printedName: null),
            ],
        );

        $lookup = $resolver->buildLocalizedLookup($this->snapshotWithCard('source-1'), [], ['es']);

        self::assertSame('Sol Ring', $lookup['es']['source-1']['name']);
        self::assertSame('en', $lookup['es']['source-1']['lang']);
    }

    public function testFallsBackToRequestedLanguageByNormalizedNameWhenExactPrintIsMissing(): void
    {
        $sourceResult = $this->resultWithRows([$this->sourceRow()]);
        $exactCandidates = $this->resultWithRows([
            $this->candidateRow(sourceScryfallId: 'source-1', candidateScryfallId: 'en-cmm-1', lang: 'en', imageStatus: null),
        ]);
        $fallbackCandidates = $this->resultWithRows([
            $this->candidateRow(sourceScryfallId: 'source-1', candidateScryfallId: 'es-alt-99', lang: 'es', imageStatus: null),
        ]);
        $payloadResult = $this->resultWithRows([
            $this->payloadRow(scryfallId: 'es-alt-99', lang: 'es', printedName: 'Anillo solar'),
        ]);

        $connection = $this->createMock(Connection::class);
        $connection->method('fetchOne')->willThrowException(new \RuntimeException('not supported in test'));
        $connection->expects(self::exactly(4))
            ->method('executeQuery')
            ->willReturnOnConsecutiveCalls(
                $sourceResult,
                $exactCandidates,
                $fallbackCandidates,
                $payloadResult,
            );

        $resolver = new GameWebsocketCardLocalizationResolver($connection);
        $lookup = $resolver->buildLocalizedLookup($this->snapshotWithCard('source-1'), [], ['es']);

        self::assertSame('Anillo solar', $lookup['es']['source-1']['name']);
        self::assertSame('es', $lookup['es']['source-1']['lang']);
    }

    public function testDoesNotQueryLegacyExactCandidatesWhenPrintTablesCoverRequestedSourceIds(): void
    {
        $sourceResult = $this->resultWithRows([
            $this->sourceRow(),
        ]);
        $printExactResult = $this->resultWithRows([
            $this->candidateRow(sourceScryfallId: 'source-1', candidateScryfallId: 'es-cmm-1', lang: 'es', imageStatus: null),
            $this->candidateRow(sourceScryfallId: 'source-1', candidateScryfallId: 'en-cmm-1', lang: 'en', imageStatus: null),
        ]);
        $printPayloadResult = $this->resultWithRows([
            $this->payloadRow(scryfallId: 'es-cmm-1', lang: 'es', printedName: 'Anillo solar'),
        ]);

        $connection = $this->createMock(Connection::class);
        $connection->expects(self::exactly(2))
            ->method('fetchOne')
            ->willReturnOnConsecutiveCalls('card_print', 'card_print_locale');
        $connection->method('executeQuery')
            ->willReturnCallback(function (string $sql) use ($sourceResult, $printExactResult, $printPayloadResult): Result {
                if (str_contains($sql, 'FROM card_print p') && str_contains($sql, 'INNER JOIN card_print_locale l')) {
                    return $printPayloadResult;
                }

                if (str_contains($sql, 'FROM card_print p') && str_contains($sql, 'WHERE p.scryfall_id IN (:ids)')) {
                    return $sourceResult;
                }

                if (str_contains($sql, 'FROM card_print source')) {
                    return $printExactResult;
                }

                if (str_contains($sql, 'FROM card source') || str_contains($sql, 'FROM card')) {
                    self::fail('Legacy card query should not be executed when print tables cover all source ids.');
                }

                self::fail('Unexpected SQL in resolver test: '.$sql);
            });

        $resolver = new GameWebsocketCardLocalizationResolver($connection);
        $lookup = $resolver->buildLocalizedLookup($this->snapshotWithCard('source-1'), [], ['es']);

        self::assertSame('Anillo solar', $lookup['es']['source-1']['name']);
        self::assertSame('es', $lookup['es']['source-1']['lang']);
    }

    /**
     * @param list<array<string,mixed>> $sources
     * @param list<array<string,mixed>> $candidates
     * @param list<array<string,mixed>> $payloads
     */
    private function resolverWithRows(array $sources, array $candidates, array $payloads): GameWebsocketCardLocalizationResolver
    {
        $sourceResult = $this->resultWithRows($sources);
        $candidateResult = $this->resultWithRows($candidates);
        $payloadResult = $this->resultWithRows($payloads);

        $connection = $this->createMock(Connection::class);
        $connection->method('fetchOne')->willThrowException(new \RuntimeException('not supported in test'));
        $connection->expects(self::exactly(3))
            ->method('executeQuery')
            ->willReturnOnConsecutiveCalls(
                $sourceResult,
                $candidateResult,
                $payloadResult,
            );

        return new GameWebsocketCardLocalizationResolver($connection);
    }

    /**
     * @param list<array<string,mixed>> $rows
     */
    private function resultWithRows(array $rows): Result
    {
        $result = $this->createMock(Result::class);
        $result->method('fetchAllAssociative')->willReturn($rows);

        return $result;
    }

    /**
     * @return array<string,mixed>
     */
    private function sourceRow(): array
    {
        return [
            'scryfall_id' => 'source-1',
            'normalized_name' => 'sol ring',
            'set_code' => 'cmm',
            'collector_number' => '1',
            'name' => 'Sol Ring',
            'printed_name' => null,
            'lang' => 'en',
            'image_uris' => '{"normal":"https://img/en.jpg"}',
            'card_faces' => '[]',
            'type_line' => 'Artifact',
            'mana_cost' => '{1}',
            'oracle_text' => '{T}: Add {C}.',
            'image_status' => null,
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function candidateRow(string $sourceScryfallId, string $candidateScryfallId, string $lang, ?string $imageStatus): array
    {
        return [
            'source_scryfall_id' => $sourceScryfallId,
            'candidate_scryfall_id' => $candidateScryfallId,
            'lang' => $lang,
            'image_status' => $imageStatus,
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function payloadRow(string $scryfallId, string $lang, ?string $printedName): array
    {
        return [
            'scryfall_id' => $scryfallId,
            'lang' => $lang,
            'name' => 'Sol Ring',
            'printed_name' => $printedName,
            'image_uris' => sprintf('{"normal":"https://img/%s.jpg"}', $lang),
            'card_faces' => '[]',
            'type_line' => $lang === 'es' ? 'Artefacto' : 'Artifact',
            'mana_cost' => '{1}',
            'oracle_text' => $lang === 'es' ? '{T}: Agrega {C}.' : '{T}: Add {C}.',
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function snapshotWithCard(string $scryfallId): array
    {
        return [
            'players' => [
                'player-1' => [
                    'zones' => [
                        'library' => [
                            ['scryfallId' => $scryfallId],
                        ],
                    ],
                ],
            ],
        ];
    }
}
