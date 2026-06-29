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
                '--scenario' => ['ws_card_tapped', 'ws_draw_1', 'ws_draw_7', 'ws_reveal_top_10', 'ws_reorder_top_10', 'ws_cards_moved'],
                '--format' => 'json',
                '--output' => $reportFile,
                '--raw-output' => $rawFile,
                '--fail-on-regression' => true,
            ]);

            self::assertSame(Command::SUCCESS, $status, $tester->getDisplay());
            $report = json_decode((string) file_get_contents($reportFile), true, flags: JSON_THROW_ON_ERROR);
            self::assertSame(1, $report['iterations']);
            self::assertCount(6, $report['scenarios']);
            self::assertSame('ws_card_tapped', $report['scenarios'][0]['name']);
            self::assertSame('ws_draw_1', $report['scenarios'][1]['name']);
            self::assertSame('ws_draw_7', $report['scenarios'][2]['name']);
            self::assertSame('ws_reveal_top_10', $report['scenarios'][3]['name']);
            self::assertSame('ws_reorder_top_10', $report['scenarios'][4]['name']);
            self::assertSame('ws_cards_moved', $report['scenarios'][5]['name']);
            self::assertArrayHasKey('performanceTargets', $report);
            self::assertArrayHasKey('gate', $report);
            self::assertArrayHasKey('resync_rate', $report['gate']['checks']);
            self::assertTrue($report['gate']['checks']['simple_command_apply_p95_ms']['measured']);
            self::assertTrue($report['gate']['checks']['simple_total_server_p95_ms']['measured']);
            self::assertTrue($report['gate']['checks']['simple_patch_bytes_max']['measured']);
            foreach ([
                'runtime_failure_count_max',
                'runtime_fallback_count_max',
                'zero_total_server_count_max',
                'runtime_hot_path_counter_missing_count_max',
                'runtime_legacy_hot_path_counter_count_max',
            ] as $checkKey) {
                self::assertArrayHasKey($checkKey, $report['gate']['checks']);
            }
            foreach ($report['scenarios'] as $scenario) {
                self::assertNotEmpty($scenario['commandMetrics']);
                self::assertGreaterThan(0, $scenario['summary']['avg_total_server_ms']);
                self::assertSame(0, $scenario['summary']['runtime_failure_count']);
                self::assertSame(0, $scenario['summary']['runtime_fallback_count']);
                self::assertSame(0, $scenario['summary']['zero_total_server_count']);
                self::assertArrayHasKey('p95_command_apply_ms', $scenario['summary']);
                self::assertArrayHasKey('avg_snapshot_write_bytes_delta', $scenario['summary']);
                self::assertArrayHasKey('avg_io_write_bytes', $scenario['summary']);
                self::assertArrayHasKey('avg_io_write_ops', $scenario['summary']);
                foreach ($scenario['commandMetrics'] as $metric) {
                    self::assertNotContains($metric['status'] ?? '', ['runtime_failed', 'runtime_patch_contract_failed', 'runtime_fallback']);
                    self::assertGreaterThan(0, (float) ($metric['total_server_ms'] ?? 0), json_encode($metric, JSON_THROW_ON_ERROR));
                    if ((float) ($metric['gameplay.runtime_route'] ?? 0) <= 0.0) {
                        continue;
                    }
                    foreach ([
                        'runtime.snapshot_load_count',
                        'runtime.snapshot_write_count',
                        'runtime.db_lock_count',
                        'runtime.legacy_handler_count',
                        'runtime.previous_next_projection_count',
                        'runtime.emergency_fallback_count',
                    ] as $counter) {
                        self::assertArrayHasKey($counter, $metric);
                        self::assertSame(0, (int) $metric[$counter], sprintf('%s in %s', $counter, json_encode($metric, JSON_THROW_ON_ERROR)));
                    }
                }
            }
            self::assertGreaterThan(0, filesize($rawFile));
        } finally {
            @unlink($reportFile);
            @unlink($rawFile);
        }
    }

    public function testPerformanceGateFailsRuntimeFailuresFallbackAndMissingHotPathCounters(): void
    {
        $command = static::getContainer()->get(GameplayBaselineCommand::class);
        $method = new \ReflectionMethod($command, 'evaluatePerformanceGate');
        $method->setAccessible(true);

        $gate = $method->invoke($command, [[
            'commandMetrics' => [[
                'command.type' => 'card.tapped',
                'status' => 'runtime_failed',
                'total_server_ms' => 0.0,
                'gameplay.runtime_route' => 1,
                'gameplay.runtime_error_count' => 1,
                'gameplay.runtime_fallback_count' => 1,
                'command.legacy_fallback_count' => 1,
            ], [
                'command.type' => 'card.tapped',
                'status' => 'runtime_applied',
                'total_server_ms' => 1.0,
                'gameplay.runtime_route' => 1,
                'gameplay.runtime_error_count' => 0,
                'gameplay.runtime_fallback_count' => 0,
                'command.legacy_fallback_count' => 0,
                'runtime.snapshot_load_count' => 1,
                'runtime.snapshot_write_count' => 0,
                'runtime.db_lock_count' => 1,
                'runtime.legacy_handler_count' => 0,
                'runtime.previous_next_projection_count' => 1,
                'runtime.emergency_fallback_count' => 0,
            ]],
        ]]);

        self::assertSame('fail', $gate['status']);
        $failed = array_column($gate['failures'], 'key');
        self::assertContains('runtime_failure_count_max', $failed);
        self::assertContains('runtime_fallback_count_max', $failed);
        self::assertContains('zero_total_server_count_max', $failed);
        self::assertContains('runtime_hot_path_counter_missing_count_max', $failed);
        self::assertContains('runtime_legacy_hot_path_counter_count_max', $failed);
    }
}
