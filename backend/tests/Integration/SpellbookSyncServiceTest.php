<?php

namespace App\Tests\Integration;

use App\Application\Deck\CommanderSpellbookClient;
use App\Application\Deck\SpellbookSyncService;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;

final class SpellbookSyncServiceTest extends ApiTestCase
{
    public function testImportsVariantWithUsesProducesAndRequires(): void
    {
        $service = $this->service([
            $this->spellbookList([$this->feature(11, 'Infinite colorless mana')]),
            $this->spellbookList([$this->template(46, 'Permanent that can be cast using {C}')]),
            $this->spellbookList([$this->variant('513-5034--46')]),
        ]);

        $result = $service->sync();

        self::assertSame('success', $result['status']);
        self::assertSame(3, $result['itemsSeen']);
        self::assertSame(3, $result['itemsInserted']);
        self::assertSame('1', (string) $this->countRows('spellbook_combo_variant'));
        self::assertSame('2', (string) $this->countRows('spellbook_combo_card'));
        self::assertSame('1', (string) $this->countRows('spellbook_combo_feature'));
        self::assertSame('1', (string) $this->countRows('spellbook_combo_requirement'));
        self::assertSame(
            '6ad8011d-3471-4369-9d68-b264cc027487',
            (string) $this->entityManager->getConnection()->fetchOne("SELECT oracle_id FROM spellbook_combo_card WHERE name = 'Sol Ring'"),
        );
    }

    public function testImportsFeatureAndNormalizesFeatureType(): void
    {
        $service = $this->service([
            $this->spellbookList([$this->feature(17, 'Infinite storm count')]),
            $this->spellbookList([]),
            $this->spellbookList([]),
        ]);

        $service->sync();

        $feature = $this->entityManager->getConnection()->fetchAssociative('SELECT name, normalized_name, feature_type FROM spellbook_feature');
        self::assertIsArray($feature);
        self::assertSame('Infinite storm count', $feature['name']);
        self::assertSame('infinite storm count', $feature['normalized_name']);
        self::assertSame('storm', $feature['feature_type']);
    }

    public function testImportsTemplate(): void
    {
        $service = $this->service([
            $this->spellbookList([]),
            $this->spellbookList([$this->template(46, 'Permanent that can be cast using {C}')]),
            $this->spellbookList([]),
        ]);

        $service->sync();

        $template = $this->entityManager->getConnection()->fetchAssociative('SELECT external_id, name, scryfall_query, scryfall_api FROM spellbook_template');
        self::assertIsArray($template);
        self::assertSame('46', $template['external_id']);
        self::assertSame('Permanent that can be cast using {C}', $template['name']);
        self::assertSame('mv<=1 is:permanent', $template['scryfall_query']);
        self::assertSame('https://api.scryfall.com/cards/search?q=mv%3C%3D1', $template['scryfall_api']);
    }

    public function testRerunDoesNotDuplicateRows(): void
    {
        $service = $this->service([
            $this->spellbookList([$this->feature(11, 'Infinite colorless mana')]),
            $this->spellbookList([$this->template(46, 'Permanent that can be cast using {C}')]),
            $this->spellbookList([$this->variant('513-5034--46')]),
            $this->spellbookList([$this->feature(11, 'Infinite colorless mana')]),
            $this->spellbookList([$this->template(46, 'Permanent that can be cast using {C}')]),
            $this->spellbookList([$this->variant('513-5034--46')]),
        ]);

        $service->sync();
        $second = $service->sync();

        self::assertSame(0, $second['itemsInserted']);
        self::assertSame(0, $second['itemsUpdated']);
        self::assertSame('1', (string) $this->countRows('spellbook_combo_variant'));
        self::assertSame('2', (string) $this->countRows('spellbook_combo_card'));
        self::assertSame('1', (string) $this->countRows('spellbook_combo_feature'));
        self::assertSame('1', (string) $this->countRows('spellbook_combo_requirement'));
    }

    public function testVariantUseWithoutOracleIdWarnsAndContinues(): void
    {
        $variant = $this->variant('missing-oracle');
        $variant['uses'][] = [
            'card' => ['name' => 'Mystery Card'],
            'quantity' => 1,
            'zoneLocations' => ['B'],
        ];
        $service = $this->service([
            $this->spellbookList([$this->feature(11, 'Infinite colorless mana')]),
            $this->spellbookList([$this->template(46, 'Permanent that can be cast using {C}')]),
            $this->spellbookList([$variant]),
        ]);

        $result = $service->sync();

        self::assertSame(1, $result['itemsFailed']);
        self::assertNotSame([], $result['warnings']);
        self::assertStringContainsString('oracleId was missing', $result['warnings'][0]);
        self::assertSame('2', (string) $this->countRows('spellbook_combo_card'));
    }

    /**
     * @param list<MockResponse> $responses
     */
    private function service(array $responses): SpellbookSyncService
    {
        $client = new CommanderSpellbookClient(
            new MockHttpClient($responses),
            'CommanderZoneTest/1.0',
            100,
            0,
        );

        return new SpellbookSyncService($client, $this->entityManager->getConnection());
    }

    /**
     * @param list<array<string,mixed>> $results
     */
    private function spellbookList(array $results): MockResponse
    {
        return new MockResponse(json_encode([
            'count' => null,
            'next' => null,
            'previous' => null,
            'results' => $results,
        ], JSON_THROW_ON_ERROR));
    }

    /**
     * @return array<string,mixed>
     */
    private function feature(int $id, string $name): array
    {
        return [
            'id' => $id,
            'name' => $name,
            'uncountable' => true,
            'status' => 'S',
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function template(int $id, string $name): array
    {
        return [
            'id' => $id,
            'name' => $name,
            'scryfallQuery' => 'mv<=1 is:permanent',
            'scryfallApi' => 'https://api.scryfall.com/cards/search?q=mv%3C%3D1',
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function variant(string $id): array
    {
        return [
            'id' => $id,
            'uses' => [
                [
                    'card' => [
                        'name' => 'Hullbreaker Horror',
                        'oracleId' => 'd4a84e78-d9b9-4c67-8a4b-4329e65f0f15',
                    ],
                    'quantity' => 1,
                    'zoneLocations' => ['B'],
                    'mustBeCommander' => false,
                    'battlefieldCardState' => '',
                    'graveyardCardState' => '',
                    'libraryCardState' => '',
                    'exileCardState' => '',
                ],
                [
                    'card' => [
                        'name' => 'Sol Ring',
                        'oracleId' => '6ad8011d-3471-4369-9d68-b264cc027487',
                    ],
                    'quantity' => 1,
                    'zoneLocations' => ['B'],
                    'mustBeCommander' => false,
                    'battlefieldCardState' => '',
                    'graveyardCardState' => '',
                    'libraryCardState' => '',
                    'exileCardState' => '',
                ],
            ],
            'status' => 'OK',
            'spoiler' => false,
            'identity' => 'U',
            'produces' => [
                [
                    'feature' => ['id' => 11, 'name' => 'Infinite colorless mana'],
                    'quantity' => 1,
                ],
            ],
            'requires' => [
                [
                    'template' => $this->template(46, 'Permanent that can be cast using {C}'),
                    'quantity' => 1,
                    'zoneLocations' => ['H'],
                    'mustBeCommander' => false,
                    'battlefieldCardState' => '',
                    'graveyardCardState' => '',
                    'libraryCardState' => '',
                    'exileCardState' => '',
                ],
            ],
            'legalities' => ['commander' => true],
            'popularity' => 326996,
            'bracketTag' => 'E',
            'description' => 'Fixture combo description.',
            'manaNeeded' => '',
            'variantCount' => 1,
            'manaValueNeeded' => 0,
            'easyPrerequisites' => '',
            'notablePrerequisites' => '',
        ];
    }

    private function countRows(string $table): int
    {
        return (int) $this->entityManager->getConnection()->fetchOne(sprintf('SELECT COUNT(*) FROM %s', $table));
    }
}
