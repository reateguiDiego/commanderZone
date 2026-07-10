<?php

namespace App\Tests\Integration;

use App\UI\Console\GameplayBaselineCommand;

class GameplayBaselineCommandTest extends ApiTestCase
{
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
                'gameplay.runtime_patch_contract_error' => 1,
                'command.legacy_fallback_count' => 1,
                'runtime.initial_state_per_command_count' => 1,
                'command.unsupported_count' => 1,
            ], [
                'command.type' => 'card.tapped',
                'status' => 'runtime_applied',
                'total_server_ms' => 1.0,
                'gameplay.runtime_route' => 1,
                'gameplay.runtime_error_count' => 0,
                'gameplay.runtime_fallback_count' => 0,
                'gameplay.runtime_patch_contract_error' => 0,
                'command.legacy_fallback_count' => 0,
                'runtime.initial_state_per_command_count' => 0,
                'command.unsupported_count' => 0,
                'runtime.snapshot_load_count' => 1,
                'runtime.snapshot_write_count' => 1,
                'runtime.db_lock_count' => 1,
                'runtime.legacy_handler_count' => 1,
                'runtime.previous_next_projection_count' => 1,
                'runtime.emergency_fallback_count' => 1,
            ]],
        ]]);

        self::assertSame('fail', $gate['status']);
        $failed = array_column($gate['failures'], 'key');
        self::assertContains('runtime_failure_count_max', $failed);
        self::assertContains('runtime_fallback_count_max', $failed);
        self::assertContains('zero_total_server_count_max', $failed);
        self::assertContains('runtime_initial_state_per_command_count_max', $failed);
        self::assertContains('runtime_unsupported_command_count_max', $failed);
        self::assertContains('runtime_patch_contract_error_count_max', $failed);
        self::assertContains('runtime_hot_path_counter_missing_count_max', $failed);
        self::assertContains('runtime_snapshot_load_count_max', $failed);
        self::assertContains('runtime_snapshot_write_count_max', $failed);
        self::assertContains('runtime_db_lock_count_max', $failed);
        self::assertContains('runtime_legacy_handler_count_max', $failed);
        self::assertContains('runtime_previous_next_projection_count_max', $failed);
        self::assertContains('runtime_emergency_fallback_count_max', $failed);
        self::assertContains('runtime_legacy_hot_path_counter_count_max', $failed);
        self::assertNotEmpty($gate['criticalFailures']);
        self::assertSame([], $gate['advisoryFailures']);
    }

    public function testPerformanceGateFailsWhenRuntimeRouteIsNotMeasured(): void
    {
        $command = static::getContainer()->get(GameplayBaselineCommand::class);
        $method = new \ReflectionMethod($command, 'evaluatePerformanceGate');
        $method->setAccessible(true);

        $gate = $method->invoke($command, [[
            'commandMetrics' => [[
                'command.type' => 'card.tapped',
                'status' => 'applied',
                'total_server_ms' => 1.0,
                'gameplay.runtime_route' => 0,
                'gameplay.runtime_error_count' => 0,
                'gameplay.runtime_fallback_count' => 0,
                'command.legacy_fallback_count' => 0,
            ]],
        ]], true);

        self::assertSame('fail', $gate['status']);
        self::assertSame('fail', $gate['checks']['runtime_route_records_min']['status']);
        self::assertSame(0.0, $gate['checks']['runtime_route_records_min']['actual']);
    }

    public function testPerformanceGateKeepsLatencyAndPayloadFailuresAdvisory(): void
    {
        $command = static::getContainer()->get(GameplayBaselineCommand::class);
        $method = new \ReflectionMethod($command, 'evaluatePerformanceGate');
        $method->setAccessible(true);

        $gate = $method->invoke($command, [[
            'commandMetrics' => [[
                'command.type' => 'card.tapped',
                'status' => 'applied',
                'total_server_ms' => 20.0,
                'command_apply_ms' => 3.0,
                'patch_bytes' => 2048,
                'gameplay.runtime_route' => 0,
                'gameplay.runtime_error_count' => 0,
                'gameplay.runtime_fallback_count' => 0,
                'command.legacy_fallback_count' => 0,
            ]],
        ]], false);

        self::assertSame('pass', $gate['status']);
        self::assertSame([], $gate['criticalFailures']);
        self::assertSame(
            ['simple_command_apply_p95_ms', 'simple_total_server_p95_ms', 'simple_patch_bytes_max'],
            array_column($gate['advisoryFailures'], 'key'),
        );
    }
}
