<?php

namespace App\Tests\Integration;

use App\UI\Console\GameplayBaselineCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;

class GameplayBaselineCommandTest extends ApiTestCase
{
    public function testBaselineCommandProducesComparableReportForFilteredScenarios(): void
    {
        $reportFile = tempnam(sys_get_temp_dir(), 'gameplay-baseline-report-');
        $rawFile = tempnam(sys_get_temp_dir(), 'gameplay-baseline-raw-');
        self::assertNotFalse($reportFile);
        self::assertNotFalse($rawFile);

        try {
            $command = static::getContainer()->get(GameplayBaselineCommand::class);
            $tester = new CommandTester($command);
            $status = $tester->execute([
                '--iterations' => '1',
                '--scenario' => ['http_draw_1', 'ws_draw_1'],
                '--format' => 'json',
                '--output' => $reportFile,
                '--raw-output' => $rawFile,
            ]);

            self::assertSame(Command::SUCCESS, $status);
            $report = json_decode((string) file_get_contents($reportFile), true, flags: JSON_THROW_ON_ERROR);
            self::assertSame(1, $report['iterations']);
            self::assertCount(2, $report['scenarios']);
            self::assertSame('http_draw_1', $report['scenarios'][0]['name']);
            self::assertSame('ws_draw_1', $report['scenarios'][1]['name']);
            self::assertNotEmpty($report['scenarios'][0]['commandMetrics']);
            self::assertNotEmpty($report['scenarios'][1]['commandMetrics']);
            self::assertGreaterThan(0, $report['scenarios'][0]['summary']['avg_total_server_ms']);
            self::assertGreaterThan(0, $report['scenarios'][1]['summary']['avg_total_server_ms']);
            self::assertGreaterThan(0, filesize($rawFile));
        } finally {
            @unlink($reportFile);
            @unlink($rawFile);
        }
    }
}
