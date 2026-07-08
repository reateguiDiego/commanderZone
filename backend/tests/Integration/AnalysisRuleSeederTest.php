<?php

namespace App\Tests\Integration;

use App\Application\Deck\AnalysisRuleSeeder;

final class AnalysisRuleSeederTest extends ApiTestCase
{
    public function testSeedCreatesGenericCommanderRules(): void
    {
        $result = $this->seeder()->seed();

        self::assertSame(27, $result['seen']);
        self::assertSame(27, $result['inserted']);
        self::assertSame(0, $result['updated']);

        $landsRule = $this->rule(null, 'lands');
        self::assertSame('commander', $landsRule['format']);
        self::assertNull($landsRule['archetype']);
        self::assertSame('34', $this->numericString($landsRule['min_recommended']));
        self::assertSame('38', $this->numericString($landsRule['max_recommended']));
        self::assertSame('warning', $landsRule['severity']);
        self::assertSame('deck_analysis.commander.generic.lands', $landsRule['message_key']);
        self::assertTrue((bool) $landsRule['active']);
    }

    public function testSeedCanRunTwiceWithoutDuplicatingRules(): void
    {
        $this->seeder()->seed();
        $firstCount = $this->ruleCount();

        $result = $this->seeder()->seed();

        self::assertSame(27, $firstCount);
        self::assertSame(27, $this->ruleCount());
        self::assertSame(['seen' => 27, 'inserted' => 0, 'updated' => 27], $result);
    }

    public function testArchetypeRuleIsStoredCorrectly(): void
    {
        $this->seeder()->seed();

        $rule = $this->rule('voltron', 'protection');

        self::assertSame('commander', $rule['format']);
        self::assertSame('voltron', $rule['archetype']);
        self::assertNull($rule['power_band']);
        self::assertSame('5', $this->numericString($rule['min_recommended']));
        self::assertNull($rule['max_recommended']);
        self::assertSame('warning', $rule['severity']);
        self::assertSame('deck_analysis.commander.voltron.protection', $rule['message_key']);
    }

    private function seeder(): AnalysisRuleSeeder
    {
        return new AnalysisRuleSeeder($this->entityManager->getConnection());
    }

    /**
     * @return array<string,mixed>
     */
    private function rule(?string $archetype, string $metric): array
    {
        $row = $this->entityManager->getConnection()->fetchAssociative(
            <<<'SQL'
SELECT *
FROM analysis_rule
WHERE format = 'commander'
  AND COALESCE(archetype, '') = COALESCE(:archetype, '')
  AND metric = :metric
SQL,
            [
                'archetype' => $archetype,
                'metric' => $metric,
            ],
        );
        self::assertIsArray($row);

        return $row;
    }

    private function ruleCount(): int
    {
        return (int) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM analysis_rule');
    }

    private function numericString(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        return rtrim(rtrim((string) $value, '0'), '.');
    }
}
