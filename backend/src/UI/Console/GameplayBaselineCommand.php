<?php

namespace App\UI\Console;

use App\Application\Game\Debug\GameDebugHealthLiveStore;
use App\Application\Game\Compact\CompactGameCardStateMapper;
use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameProjectionService;
use App\Application\Game\Performance\GameplayBaselineFixture;
use App\Application\Game\Performance\GameplayBaselineFixtureFactory;
use App\Application\Game\Performance\GameplayMetricsInspector;
use App\Application\Game\Performance\GameplayMetricsStore;
use App\Application\Game\WebSocket\GameWebsocketCommandPatchService;
use App\Application\Game\WebSocket\GameWebsocketPeer;
use App\Application\Game\WebSocket\GameWebsocketRoomRegistry;
use App\Domain\Game\Game;
use App\Domain\Game\GameSnapshotCompact;
use App\Domain\User\User;
use App\Infrastructure\Realtime\GameEventPublisher;
use App\UI\Http\GamesController;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\HttpFoundation\Request;

#[AsCommand(
    name: 'app:gameplay:baseline',
    description: 'Runs reproducible gameplay performance baselines against the current architecture.',
)]
final class GameplayBaselineCommand extends Command
{
    /**
     * @var array<string,array{kind:string, handler:string}>
     */
    private const SCENARIOS = [
        'snapshot_bootstrap' => ['kind' => 'snapshot', 'handler' => 'runSnapshotBootstrapScenario'],
        'http_draw_1' => ['kind' => 'command', 'handler' => 'runHttpDrawOneScenario'],
        'ws_card_tapped' => ['kind' => 'command', 'handler' => 'runWebsocketCardTappedScenario'],
        'ws_draw_1' => ['kind' => 'command', 'handler' => 'runWebsocketDrawOneScenario'],
        'ws_draw_7' => ['kind' => 'command', 'handler' => 'runWebsocketDrawSevenScenario'],
        'ws_draw_many_20' => ['kind' => 'command', 'handler' => 'runWebsocketDrawManyLargeScenario'],
        'ws_reveal_top_1' => ['kind' => 'command', 'handler' => 'runWebsocketRevealTopOneScenario'],
        'ws_reveal_top_10' => ['kind' => 'command', 'handler' => 'runWebsocketRevealTopTenScenario'],
        'ws_reorder_top_10' => ['kind' => 'command', 'handler' => 'runWebsocketReorderTopTenScenario'],
        'ws_cards_moved' => ['kind' => 'command', 'handler' => 'runWebsocketCardsMovedScenario'],
        'ws_zone_move_all' => ['kind' => 'command', 'handler' => 'runWebsocketZoneMoveAllScenario'],
        'ws_create_20_tokens' => ['kind' => 'command', 'handler' => 'runWebsocketCreateTwentyTokensScenario'],
        'ws_drag_final_batch' => ['kind' => 'command', 'handler' => 'runWebsocketDragFinalBatchScenario'],
        'ws_drag_positions_repeated' => ['kind' => 'command', 'handler' => 'runWebsocketDragRepeatedScenario'],
        'ws_duplicate_client_action' => ['kind' => 'command', 'handler' => 'runWebsocketDuplicateClientActionScenario'],
        'ws_simultaneous_conflict' => ['kind' => 'command', 'handler' => 'runWebsocketSimultaneousConflictScenario'],
        'snapshot_disconnect_reconnect' => ['kind' => 'snapshot', 'handler' => 'runSnapshotReconnectScenario'],
    ];
    private const PROFILE_SCENARIOS = [
        'smoke' => ['ws_card_tapped', 'ws_draw_1', 'ws_reveal_top_1', 'ws_cards_moved', 'ws_drag_final_batch', 'snapshot_disconnect_reconnect'],
        'manual' => [],
        'nightly' => [],
    ];
    private const SIMPLE_COMMAND_TYPES = [
        'life.changed',
        'turn.changed',
        'dice.rolled',
        'counter.changed',
        'card.tapped',
        'card.counter.changed',
        'card.power_toughness.changed',
        'card.position.changed',
    ];
    private const PERFORMANCE_TARGETS = [
        'simple_command_apply_p95_ms' => ['label' => 'command.apply_ms simple p95', 'operator' => '<', 'limit' => 2.0, 'severity' => 'advisory'],
        'simple_total_server_p95_ms' => ['label' => 'command.total_server_ms simple p95', 'operator' => '<', 'limit' => 15.0, 'severity' => 'advisory'],
        'simple_patch_bytes_max' => ['label' => 'patch.bytes simple max', 'operator' => '<', 'limit' => 1024.0, 'severity' => 'advisory'],
        'resync_rate' => ['label' => 'resync.rate', 'operator' => '<', 'limit' => 0.005, 'severity' => 'critical'],
        'event_append_p95_ms' => ['label' => 'event.append_ms p95', 'operator' => '<', 'limit' => 8.0, 'severity' => 'advisory'],
        'position_commands_per_drag_max' => ['label' => 'position.commands_per_drag max', 'operator' => '<=', 'limit' => 1.0, 'severity' => 'critical'],
        'full_scan_count_max' => ['label' => 'full_scan_count max', 'operator' => '<=', 'limit' => 0.0, 'severity' => 'advisory'],
        'snapshot_full_write_count_max' => ['label' => 'snapshot full write count max', 'operator' => '<=', 'limit' => 0.0, 'severity' => 'critical'],
        'runtime_failure_count_max' => ['label' => 'runtime failure count max', 'operator' => '<=', 'limit' => 0.0, 'severity' => 'critical'],
        'runtime_fallback_count_max' => ['label' => 'runtime fallback count max', 'operator' => '<=', 'limit' => 0.0, 'severity' => 'critical'],
        'runtime_route_records_min' => ['label' => 'runtime route records min', 'operator' => '>', 'limit' => 0.0, 'severity' => 'critical'],
        'zero_total_server_count_max' => ['label' => 'zero total_server_ms count max', 'operator' => '<=', 'limit' => 0.0, 'severity' => 'critical'],
        'runtime_hot_path_counter_missing_count_max' => ['label' => 'runtime hot-path missing counter count max', 'operator' => '<=', 'limit' => 0.0, 'severity' => 'critical'],
        'runtime_legacy_hot_path_counter_count_max' => ['label' => 'runtime legacy hot-path counter count max', 'operator' => '<=', 'limit' => 0.0, 'severity' => 'critical'],
    ];
    private const RUNTIME_FAILURE_STATUSES = [
        'runtime_failed',
        'runtime_patch_contract_failed',
    ];
    private const RUNTIME_HOT_PATH_COUNTERS = [
        'runtime.snapshot_load_count',
        'runtime.snapshot_write_count',
        'runtime.db_lock_count',
        'runtime.legacy_handler_count',
        'runtime.previous_next_projection_count',
        'runtime.emergency_fallback_count',
    ];

    public function __construct(
        private readonly EntityManagerInterface $entityManager,
        private readonly GameplayBaselineFixtureFactory $fixtureFactory,
        private readonly GameplayMetricsStore $metricsStore,
        private readonly GameplayMetricsInspector $metricsInspector,
        private readonly GamesController $gamesController,
        private readonly GameProjectionService $projection,
        private readonly GameDebugHealthLiveStore $debugHealth,
        private readonly GameCommandHandler $commandHandler,
        private readonly GameEventPublisher $publisher,
        private readonly GameWebsocketCommandPatchService $websocketCommands,
        private readonly CompactGameCardStateMapper $compactStateMapper,
        private readonly GameWebsocketRoomRegistry $roomRegistry,
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addOption('iterations', null, InputOption::VALUE_REQUIRED, 'Iterations per scenario.', '3')
            ->addOption('suite', null, InputOption::VALUE_REQUIRED, 'Scenario suite: smoke, manual, or nightly.', 'manual')
            ->addOption('scenario', null, InputOption::VALUE_REQUIRED | InputOption::VALUE_IS_ARRAY, 'Scenario name to run. Repeat to filter.')
            ->addOption('output', null, InputOption::VALUE_REQUIRED, 'Optional JSON report path.')
            ->addOption('raw-output', null, InputOption::VALUE_REQUIRED, 'Optional NDJSON path for raw per-command metrics.')
            ->addOption('compare-to', null, InputOption::VALUE_REQUIRED, 'Optional previous JSON report path for before/after comparison.')
            ->addOption('fail-on-regression', null, InputOption::VALUE_NONE, 'Exit non-zero when critical performance gates fail.')
            ->addOption('strict-targets', null, InputOption::VALUE_NONE, 'Include advisory latency/payload targets in fail-on-regression.')
            ->addOption('require-runtime-route', null, InputOption::VALUE_NONE, 'Require at least one gameplay.runtime_route sample in the command metrics.')
            ->addOption('format', null, InputOption::VALUE_REQUIRED, 'Console format: table or json.', 'table');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $iterations = max(1, (int) $input->getOption('iterations'));
        $profile = strtolower(trim((string) $input->getOption('suite')));
        $selectedScenarios = $this->selectedScenarios($input->getOption('scenario'), $profile);
        $format = (string) $input->getOption('format');
        $outputPath = is_string($input->getOption('output')) ? trim((string) $input->getOption('output')) : '';
        $rawOutputPath = is_string($input->getOption('raw-output')) ? trim((string) $input->getOption('raw-output')) : '';
        $compareToPath = is_string($input->getOption('compare-to')) ? trim((string) $input->getOption('compare-to')) : '';
        $strictTargets = (bool) $input->getOption('strict-targets');
        $requireRuntimeRoute = (bool) $input->getOption('require-runtime-route');

        $this->metricsStore->reset();
        $this->metricsStore->configureOutput($rawOutputPath !== '' ? $rawOutputPath : null, truncate: true);

        $scenarioReports = [];
        foreach ($selectedScenarios as $scenarioName => $scenarioConfig) {
            $scenarioReports[] = $this->runScenario($scenarioName, $scenarioConfig, $iterations);
        }

        $gate = $this->evaluatePerformanceGate($scenarioReports, $requireRuntimeRoute);
        $comparison = $compareToPath !== '' ? $this->compareReports($compareToPath, $scenarioReports) : null;
        $report = [
            'generatedAt' => (new \DateTimeImmutable())->format(DATE_ATOM),
            'phpVersion' => PHP_VERSION,
            'suite' => $profile,
            'iterations' => $iterations,
            'scenarioCount' => count($scenarioReports),
            'performanceTargets' => self::PERFORMANCE_TARGETS,
            'gate' => $gate,
            'comparison' => $comparison,
            'scenarios' => $scenarioReports,
        ];

        if ($outputPath !== '') {
            $directory = dirname($outputPath);
            if (!is_dir($directory)) {
                @mkdir($directory, 0777, true);
            }
            file_put_contents($outputPath, json_encode($report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
        }

        if ($format === 'json') {
            $output->writeln(json_encode($report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));

            return $this->exitCode($input, $gate, $strictTargets);
        }

        $this->renderTable($output, $scenarioReports, $iterations, $outputPath, $rawOutputPath, $gate, $comparison);

        return $this->exitCode($input, $gate, $strictTargets);
    }

    /**
     * @param list<mixed> $selectedScenarioOptions
     *
     * @return array<string,array{kind:string, handler:string}>
     */
    private function selectedScenarios(array $selectedScenarioOptions, string $profile): array
    {
        $selected = array_values(array_filter(
            array_map(static fn (mixed $scenario): string => trim((string) $scenario), $selectedScenarioOptions),
            static fn (string $scenario): bool => $scenario !== '',
        ));
        if ($selected === [] && isset(self::PROFILE_SCENARIOS[$profile]) && self::PROFILE_SCENARIOS[$profile] !== []) {
            $selected = self::PROFILE_SCENARIOS[$profile];
        }
        if ($selected === []) {
            return self::SCENARIOS;
        }

        $scenarios = [];
        foreach ($selected as $scenario) {
            if (!isset(self::SCENARIOS[$scenario])) {
                throw new \InvalidArgumentException(sprintf('Unknown scenario "%s".', $scenario));
            }

            $scenarios[$scenario] = self::SCENARIOS[$scenario];
        }

        return $scenarios;
    }

    /**
     * @param array{kind:string, handler:string} $scenarioConfig
     *
     * @return array<string,mixed>
     */
    private function runScenario(string $scenarioName, array $scenarioConfig, int $iterations): array
    {
        $commandMetrics = [];
        $snapshotMetrics = [];

        for ($iteration = 1; $iteration <= $iterations; $iteration++) {
            $fixture = $this->persistFixture(sprintf('%s-%02d-%s', $scenarioName, $iteration, bin2hex(random_bytes(3))));
            if ($scenarioConfig['kind'] === 'snapshot') {
                $snapshotMetrics = [
                    ...$snapshotMetrics,
                    ...$this->{$scenarioConfig['handler']}($fixture, $scenarioName, $iteration),
                ];
                continue;
            }

            $before = count($this->metricsStore->records());
            $this->{$scenarioConfig['handler']}($fixture, $scenarioName, $iteration);
            foreach (array_slice($this->metricsStore->records(), $before) as $metric) {
                $commandMetrics[] = [
                    ...$metric,
                    'scenario' => $scenarioName,
                    'iteration' => $iteration,
                ];
            }
        }

        return [
            'name' => $scenarioName,
            'kind' => $scenarioConfig['kind'],
            'iterations' => $iterations,
            'commandMetrics' => $commandMetrics,
            'snapshotMetrics' => $snapshotMetrics,
            'summary' => $scenarioConfig['kind'] === 'snapshot'
                ? $this->snapshotSummary($snapshotMetrics)
                : $this->commandSummary($commandMetrics),
        ];
    }

    private function runSnapshotBootstrapScenario(GameplayBaselineFixture $fixture, string $scenarioName, int $iteration): array
    {
        return [
            $this->snapshotMetric($fixture, $fixture->user('p1'), $scenarioName, $iteration, 'bootstrap.owner'),
            $this->snapshotMetric($fixture, $fixture->user('p2'), $scenarioName, $iteration, 'bootstrap.opponent'),
        ];
    }

    private function runSnapshotReconnectScenario(GameplayBaselineFixture $fixture, string $scenarioName, int $iteration): array
    {
        $this->runWebsocketDrawOneScenario($fixture, $scenarioName, $iteration);
        $this->runWebsocketDragRepeatedScenario($fixture, $scenarioName, $iteration);

        return [
            $this->snapshotMetric($fixture, $fixture->user('p1'), $scenarioName, $iteration, 'reconnect.owner'),
            $this->snapshotMetric($fixture, $fixture->user('p3'), $scenarioName, $iteration, 'reconnect.viewer'),
        ];
    }

    private function runHttpDrawOneScenario(GameplayBaselineFixture $fixture, string $scenarioName, int $iteration): void
    {
        unset($scenarioName, $iteration);
        $request = $this->jsonRequest([
            'type' => 'library.draw',
            'clientActionId' => 'http-draw-1',
            'payload' => [
                'playerId' => $fixture->playerId('p1'),
            ],
        ]);
        $this->gamesController->command(
            $fixture->game()->id(),
            $request,
            $fixture->user('p1'),
            $this->entityManager,
            $this->commandHandler,
            $this->projection,
            $this->publisher,
            $this->metricsStore,
            $this->metricsInspector,
        );
    }

    private function runWebsocketDrawOneScenario(GameplayBaselineFixture $fixture, string $scenarioName, int $iteration): void
    {
        unset($scenarioName, $iteration);
        $this->websocketCommand($fixture, $fixture->user('p1'), 'library.draw', [
            'playerId' => $fixture->playerId('p1'),
        ], 'ws-draw-1');
    }

    private function runWebsocketCardTappedScenario(GameplayBaselineFixture $fixture, string $scenarioName, int $iteration): void
    {
        unset($scenarioName, $iteration);
        $instanceId = $fixture->battlefieldInstanceIds('p1', 1)[0] ?? '';
        $this->websocketCommand($fixture, $fixture->user('p1'), 'card.tapped', [
            'playerId' => $fixture->playerId('p1'),
            'zone' => 'battlefield',
            'instanceId' => $instanceId,
            'tapped' => true,
        ], 'ws-card-tapped');
    }

    private function runWebsocketDrawSevenScenario(GameplayBaselineFixture $fixture, string $scenarioName, int $iteration): void
    {
        unset($scenarioName, $iteration);
        $this->websocketCommand($fixture, $fixture->user('p1'), 'library.draw_many', [
            'playerId' => $fixture->playerId('p1'),
            'count' => 7,
        ], 'ws-draw-7');
    }

    private function runWebsocketDrawManyLargeScenario(GameplayBaselineFixture $fixture, string $scenarioName, int $iteration): void
    {
        unset($scenarioName, $iteration);
        $this->websocketCommand($fixture, $fixture->user('p1'), 'library.draw_many', [
            'playerId' => $fixture->playerId('p1'),
            'count' => 20,
        ], 'ws-draw-20');
    }

    private function runWebsocketRevealTopOneScenario(GameplayBaselineFixture $fixture, string $scenarioName, int $iteration): void
    {
        unset($scenarioName, $iteration);
        $this->websocketCommand($fixture, $fixture->user('p1'), 'library.reveal_top', [
            'playerId' => $fixture->playerId('p1'),
            'count' => 1,
            'to' => 'all',
        ], 'ws-reveal-top-1');
    }

    private function runWebsocketRevealTopTenScenario(GameplayBaselineFixture $fixture, string $scenarioName, int $iteration): void
    {
        unset($scenarioName, $iteration);
        $this->websocketCommand($fixture, $fixture->user('p1'), 'library.reveal_top', [
            'playerId' => $fixture->playerId('p1'),
            'count' => 10,
            'to' => 'all',
        ], 'ws-reveal-top-10');
    }

    private function runWebsocketReorderTopTenScenario(GameplayBaselineFixture $fixture, string $scenarioName, int $iteration): void
    {
        unset($scenarioName, $iteration);
        $instanceIds = array_reverse($fixture->libraryTopInstanceIds('p1', 10));
        $this->websocketCommand($fixture, $fixture->user('p1'), 'library.reorder_top', [
            'playerId' => $fixture->playerId('p1'),
            'instanceIds' => $instanceIds,
        ], 'ws-reorder-top-10');
    }

    private function runWebsocketCardsMovedScenario(GameplayBaselineFixture $fixture, string $scenarioName, int $iteration): void
    {
        unset($scenarioName, $iteration);
        $this->websocketCommand($fixture, $fixture->user('p1'), 'cards.moved', [
            'playerId' => $fixture->playerId('p1'),
            'fromZone' => 'hand',
            'toZone' => 'graveyard',
            'instanceIds' => [
                'p1-hand-061',
                'p1-hand-062',
                'p1-hand-063',
                'p1-hand-064',
                'p1-hand-065',
            ],
        ], 'ws-cards-moved');
    }

    private function runWebsocketZoneMoveAllScenario(GameplayBaselineFixture $fixture, string $scenarioName, int $iteration): void
    {
        unset($scenarioName, $iteration);
        $this->websocketCommand($fixture, $fixture->user('p1'), 'zone.move_all', [
            'playerId' => $fixture->playerId('p1'),
            'fromZone' => 'graveyard',
            'toZone' => 'exile',
        ], 'ws-zone-move-all');
    }

    private function runWebsocketCreateTwentyTokensScenario(GameplayBaselineFixture $fixture, string $scenarioName, int $iteration): void
    {
        unset($scenarioName, $iteration);
        $this->websocketCommand($fixture, $fixture->user('p1'), 'card.token.created', [
            'playerId' => $fixture->playerId('p1'),
            'quantity' => 20,
            'card' => [
                'name' => 'Performance Beast Token',
                'typeLine' => 'Token Creature - Beast',
                'power' => '3',
                'toughness' => '3',
            ],
        ], 'ws-token-20');
    }

    private function runWebsocketDragFinalBatchScenario(GameplayBaselineFixture $fixture, string $scenarioName, int $iteration): void
    {
        unset($scenarioName, $iteration);
        $instanceIds = $fixture->battlefieldInstanceIds('p1', 20);
        $positions = [];
        foreach ($instanceIds as $index => $instanceId) {
            $positions[] = [
                'instanceId' => $instanceId,
                'position' => [
                    'x' => round(0.08 + (($index % 5) * 0.17), 4),
                    'y' => round(0.12 + ((int) floor($index / 5) * 0.13), 4),
                    'unit' => 'ratio',
                ],
            ];
        }

        $this->websocketCommand($fixture, $fixture->user('p1'), 'cards.position.changed', [
            'playerId' => $fixture->playerId('p1'),
            'zone' => 'battlefield',
            'positions' => $positions,
        ], 'ws-drag-final-batch');
    }

    private function runWebsocketDragRepeatedScenario(GameplayBaselineFixture $fixture, string $scenarioName, int $iteration): void
    {
        unset($scenarioName, $iteration);
        $instanceIds = $fixture->battlefieldInstanceIds('p1', 20);
        for ($step = 1; $step <= 12; $step++) {
            $positions = [];
            foreach ($instanceIds as $index => $instanceId) {
                $positions[] = [
                    'instanceId' => $instanceId,
                    'position' => [
                        'x' => round(0.08 + (($index % 5) * 0.17) + ($step * 0.003), 4),
                        'y' => round(0.12 + ((int) floor($index / 5) * 0.13) + ($step * 0.002), 4),
                        'unit' => 'ratio',
                    ],
                ];
            }

            $this->websocketCommand($fixture, $fixture->user('p1'), 'cards.position.changed', [
                'playerId' => $fixture->playerId('p1'),
                'zone' => 'battlefield',
                'positions' => $positions,
            ], sprintf('ws-drag-%02d', $step));
        }
    }

    private function runWebsocketDuplicateClientActionScenario(GameplayBaselineFixture $fixture, string $scenarioName, int $iteration): void
    {
        unset($scenarioName, $iteration);
        $payload = [
            'playerId' => $fixture->playerId('p1'),
        ];
        $this->websocketCommand($fixture, $fixture->user('p1'), 'library.draw', $payload, 'ws-duplicate');
        $this->websocketCommand($fixture, $fixture->user('p1'), 'library.draw', $payload, 'ws-duplicate');
    }

    private function runWebsocketSimultaneousConflictScenario(GameplayBaselineFixture $fixture, string $scenarioName, int $iteration): void
    {
        unset($scenarioName, $iteration);
        $baseVersion = $this->currentVersion($fixture->game()->id());
        $this->websocketCommands->apply(
            $fixture->game()->id(),
            $fixture->user('p1')->id(),
            'library.draw',
            ['playerId' => $fixture->playerId('p1')],
            'ws-conflict-a',
            $baseVersion,
            'conflict-a',
            'v2',
            $fixture->playerId('p1'),
            ['view', 'command'],
        );
        $this->websocketCommands->apply(
            $fixture->game()->id(),
            $fixture->user('p2')->id(),
            'library.draw',
            ['playerId' => $fixture->playerId('p2')],
            'ws-conflict-b',
            $baseVersion,
            'conflict-b',
            'v2',
            $fixture->playerId('p2'),
            ['view', 'command'],
        );
    }

    private function websocketCommand(GameplayBaselineFixture $fixture, User $actor, string $type, array $payload, string $clientActionId): void
    {
        $this->websocketCommands->apply(
            $fixture->game()->id(),
            $actor->id(),
            $type,
            $payload,
            $clientActionId,
            $this->currentVersion($fixture->game()->id()),
            $clientActionId,
            'v2',
            $actor->id(),
            ['view', 'command'],
        );
    }

    /**
     * @return array<string,mixed>
     */
    private function snapshotMetric(GameplayBaselineFixture $fixture, User $viewer, string $scenarioName, int $iteration, string $stage): array
    {
        $startedAt = microtime(true);
        $usageStartedAt = $this->metricsInspector->usageSnapshot();
        $response = $this->gamesController->snapshot(
            $fixture->game()->id(),
            $viewer,
            $this->entityManager,
            $this->projection,
            $this->debugHealth,
        );
        $totalMs = round(max(0, (microtime(true) - $startedAt) * 1000), 2);
        $payload = json_decode($response->getContent() ?: '[]', true);
        $snapshot = is_array($payload['game']['snapshot'] ?? null) ? $payload['game']['snapshot'] : [];

        return [
            'scenario' => $scenarioName,
            'iteration' => $iteration,
            'stage' => $stage,
            'gameId' => $fixture->game()->id(),
            'viewerId' => $viewer->id(),
            'transport' => 'http.snapshot',
            'total_server_ms' => $totalMs,
            'snapshot_bytes' => $this->metricsInspector->jsonBytes($snapshot),
            'number_of_players' => $this->metricsInspector->countPlayers($snapshot),
            'number_of_instances' => $this->metricsInspector->countInstances($snapshot),
            'number_of_visible_cards' => $this->metricsInspector->countVisibleCards($snapshot),
            'memory_peak_bytes' => $this->metricsInspector->memoryPeakBytes(),
            ...$this->metricsInspector->cpuDiffMs($usageStartedAt),
        ];
    }

    private function persistFixture(string $slug): GameplayBaselineFixture
    {
        $fixture = $this->fixtureFactory->create($slug);
        foreach (['p1', 'p2', 'p3', 'p4'] as $key) {
            $this->entityManager->persist($fixture->user($key));
        }
        $this->entityManager->persist($fixture->game()->room());
        $this->entityManager->persist($fixture->game());
        $this->entityManager->flush();
        $this->persistRuntimeBaselineSnapshot($fixture->game());
        $this->registerRuntimePeers($fixture);

        return $fixture;
    }

    private function currentVersion(string $gameId): int
    {
        $game = $this->entityManager->getRepository(Game::class)->find($gameId);
        $connection = $this->entityManager->getConnection();
        $eventVersion = (int) ($connection->fetchOne('SELECT COALESCE(MAX(version), 0) FROM game_event WHERE game_id = ?', [$gameId]) ?: 0);
        $compactSnapshotVersion = (int) ($connection->fetchOne('SELECT COALESCE(MAX(version), 0) FROM game_snapshot_compact WHERE game_id = ?', [$gameId]) ?: 0);

        return max(
            1,
            $game instanceof Game ? (int) ($game->snapshot()['version'] ?? 1) : 1,
            $eventVersion,
            $compactSnapshotVersion,
        );
    }

    private function persistRuntimeBaselineSnapshot(Game $game): void
    {
        $compactSnapshot = $this->compactStateMapper->compactSnapshot($game->snapshot(), $game->id(), $game->status());
        unset($compactSnapshot['cardCatalog']);
        $this->entityManager->persist(new GameSnapshotCompact(
            $game,
            max(1, (int) ($compactSnapshot['version'] ?? 1)),
            $compactSnapshot,
            hash('sha256', json_encode($compactSnapshot, JSON_THROW_ON_ERROR)),
        ));
        $this->entityManager->flush();
    }

    private function registerRuntimePeers(GameplayBaselineFixture $fixture): void
    {
        foreach (['p1', 'p2', 'p3', 'p4'] as $key) {
            $user = $fixture->user($key);
            $this->roomRegistry->join(new GameWebsocketPeer(
                sprintf('baseline-%s-%s', $fixture->game()->id(), $user->id()),
                $fixture->game()->id(),
                $user->id(),
                $user->displayName(),
                new \DateTimeImmutable(),
                static function (array $message): void {
                    unset($message);
                },
                $fixture->playerId($key),
                ['view', 'command'],
            ));
        }
    }

    private function jsonRequest(array $payload): Request
    {
        return Request::create(
            '/baseline',
            'POST',
            server: ['CONTENT_TYPE' => 'application/json'],
            content: json_encode($payload, JSON_THROW_ON_ERROR),
        );
    }

    /**
     * @param list<array<string,mixed>> $metrics
     *
     * @return array<string,mixed>
     */
    private function commandSummary(array $metrics): array
    {
        return [
            'command_count' => count($metrics),
            'resync_count' => count(array_filter($metrics, static fn (array $metric): bool => (bool) ($metric['resync_required'] ?? false))),
            'duplicate_count' => count(array_filter($metrics, static fn (array $metric): bool => (bool) ($metric['clientActionId_duplicate'] ?? false))),
            'runtime_failure_count' => $this->runtimeFailureCount($metrics),
            'runtime_fallback_count' => $this->runtimeFallbackCount($metrics),
            'zero_total_server_count' => $this->zeroTotalServerCount($metrics),
            'runtime_hot_path_counter_missing_count' => $this->runtimeHotPathCounterMissingCount($metrics),
            'runtime_legacy_hot_path_counter_count' => $this->runtimeLegacyHotPathCounterCount($metrics),
            'avg_total_server_ms' => $this->average($metrics, 'total_server_ms'),
            'p95_total_server_ms' => $this->percentile($metrics, 'total_server_ms', 95),
            'p95_command_apply_ms' => $this->percentile($metrics, 'command_apply_ms', 95),
            'p95_event_append_ms' => $this->percentile($metrics, 'event_append_ms', 95, fallbackKey: 'persist_ms'),
            'p95_patch_bytes' => $this->percentile($metrics, 'patch_bytes', 95),
            'max_patch_bytes' => $this->maxValue($metrics, 'patch_bytes'),
            'avg_snapshot_bytes_before' => $this->average($metrics, 'snapshot_bytes_before'),
            'avg_snapshot_bytes_after' => $this->average($metrics, 'snapshot_bytes_after'),
            'avg_snapshot_write_bytes_delta' => $this->averageDelta($metrics, 'snapshot_bytes_before', 'snapshot_bytes_after'),
            'avg_patch_bytes' => $this->average($metrics, 'patch_bytes'),
            'avg_projection_ms' => $this->average($metrics, 'projection_ms'),
            'avg_patch_build_ms' => $this->average($metrics, 'patch_build_ms'),
            'avg_memory_peak_bytes' => $this->average($metrics, 'memory_peak_bytes'),
            'avg_cpu_user_ms' => $this->average($metrics, 'cpu_user_ms'),
            'avg_cpu_system_ms' => $this->average($metrics, 'cpu_system_ms'),
            'avg_io_write_bytes' => $this->averageIoWriteBytes($metrics),
            'max_io_write_bytes' => $this->maxIoWriteBytes($metrics),
            'avg_io_write_ops' => $this->averageIoWriteOps($metrics),
            'avg_actor_queue_depth' => $this->average($metrics, 'actor.queue_depth'),
            'max_actor_queue_depth' => $this->maxValue($metrics, 'actor.queue_depth'),
            'max_full_scan_count' => $this->maxValue($metrics, 'full_scan_count'),
            'max_snapshot_full_write_count' => $this->maxValue($metrics, 'snapshot_full_write_count'),
            'max_position_commands_per_drag' => $this->maxValue($metrics, 'position.commands_per_drag'),
            'resync_rate' => count($metrics) > 0 ? round(count(array_filter($metrics, static fn (array $metric): bool => (bool) ($metric['resync_required'] ?? false))) / count($metrics), 4) : 0.0,
        ];
    }

    /**
     * @param list<array<string,mixed>> $metrics
     *
     * @return array<string,mixed>
     */
    private function snapshotSummary(array $metrics): array
    {
        return [
            'snapshot_count' => count($metrics),
            'avg_total_server_ms' => $this->average($metrics, 'total_server_ms'),
            'p95_total_server_ms' => $this->percentile($metrics, 'total_server_ms', 95),
            'avg_snapshot_bytes' => $this->average($metrics, 'snapshot_bytes'),
            'avg_visible_cards' => $this->average($metrics, 'number_of_visible_cards'),
            'avg_memory_peak_bytes' => $this->average($metrics, 'memory_peak_bytes'),
            'avg_cpu_user_ms' => $this->average($metrics, 'cpu_user_ms'),
            'avg_cpu_system_ms' => $this->average($metrics, 'cpu_system_ms'),
        ];
    }

    /**
     * @param list<array<string,mixed>> $metrics
     */
    private function average(array $metrics, string $key): float
    {
        if ($metrics === []) {
            return 0.0;
        }

        $values = array_map(static fn (array $metric): float => (float) ($metric[$key] ?? 0), $metrics);

        return round(array_sum($values) / count($values), 2);
    }

    /**
     * @param list<array<string,mixed>> $metrics
     */
    private function percentile(array $metrics, string $key, int $percentile, ?string $fallbackKey = null): float
    {
        if ($metrics === []) {
            return 0.0;
        }

        $values = array_map(static fn (array $metric): float => (float) ($metric[$key] ?? ($fallbackKey !== null ? ($metric[$fallbackKey] ?? 0) : 0)), $metrics);
        sort($values);
        $rank = max(0, min(count($values) - 1, (int) ceil((max(0, min(100, $percentile)) / 100) * count($values)) - 1));

        return round($values[$rank] ?? 0.0, 2);
    }

    /**
     * @param list<array<string,mixed>> $metrics
     */
    private function maxValue(array $metrics, string $key): float
    {
        if ($metrics === []) {
            return 0.0;
        }

        return round(max(array_map(static fn (array $metric): float => (float) ($metric[$key] ?? 0), $metrics)), 2);
    }

    /**
     * @param list<array<string,mixed>> $metrics
     */
    private function averageDelta(array $metrics, string $beforeKey, string $afterKey): float
    {
        if ($metrics === []) {
            return 0.0;
        }

        $values = array_map(static fn (array $metric): float => max(0.0, (float) ($metric[$afterKey] ?? 0) - (float) ($metric[$beforeKey] ?? 0)), $metrics);

        return round(array_sum($values) / count($values), 2);
    }

    /**
     * @param list<array<string,mixed>> $metrics
     */
    private function averageIoWriteBytes(array $metrics): float
    {
        if ($metrics === []) {
            return 0.0;
        }

        $values = array_map(fn (array $metric): float => $this->ioWriteBytes($metric), $metrics);

        return round(array_sum($values) / count($values), 2);
    }

    /**
     * @param list<array<string,mixed>> $metrics
     */
    private function maxIoWriteBytes(array $metrics): float
    {
        if ($metrics === []) {
            return 0.0;
        }

        return round(max(array_map(fn (array $metric): float => $this->ioWriteBytes($metric), $metrics)), 2);
    }

    /**
     * @param list<array<string,mixed>> $metrics
     */
    private function averageIoWriteOps(array $metrics): float
    {
        if ($metrics === []) {
            return 0.0;
        }

        $values = array_map(static fn (array $metric): float => (float) ($metric['io.write_ops'] ?? ((float) ($metric['persist_ms'] ?? 0.0) > 0.0 ? 1 : 0)), $metrics);

        return round(array_sum($values) / count($values), 2);
    }

    /**
     * @param array<string,mixed> $metric
     */
    private function ioWriteBytes(array $metric): float
    {
        if (isset($metric['io.write_bytes'])) {
            return (float) $metric['io.write_bytes'];
        }

        return max(0.0, (float) ($metric['snapshot_bytes_after'] ?? 0) - (float) ($metric['snapshot_bytes_before'] ?? 0));
    }

    /**
     * @param list<array<string,mixed>> $metrics
     */
    private function runtimeFailureCount(array $metrics): int
    {
        return count(array_filter(
            $metrics,
            static fn (array $metric): bool => in_array((string) ($metric['status'] ?? ''), self::RUNTIME_FAILURE_STATUSES, true)
                || (float) ($metric['gameplay.runtime_error_count'] ?? 0) > 0.0,
        ));
    }

    /**
     * @param list<array<string,mixed>> $metrics
     */
    private function runtimeFallbackCount(array $metrics): int
    {
        return (int) array_sum(array_map(
            static fn (array $metric): int => max(
                (int) ((float) ($metric['gameplay.runtime_fallback_count'] ?? 0)),
                (int) ((float) ($metric['command.legacy_fallback_count'] ?? 0)),
                (string) ($metric['status'] ?? '') === 'runtime_fallback' ? 1 : 0,
            ),
            $metrics,
        ));
    }

    /**
     * @param list<array<string,mixed>> $metrics
     */
    private function zeroTotalServerCount(array $metrics): int
    {
        return count(array_filter(
            $metrics,
            static fn (array $metric): bool => (float) ($metric['total_server_ms'] ?? 0.0) <= 0.0,
        ));
    }

    /**
     * @param list<array<string,mixed>> $metrics
     */
    private function runtimeHotPathCounterMissingCount(array $metrics): int
    {
        $missing = 0;
        foreach ($this->runtimeRouteMetrics($metrics) as $metric) {
            foreach (self::RUNTIME_HOT_PATH_COUNTERS as $counter) {
                if (!array_key_exists($counter, $metric)) {
                    $missing++;
                }
            }
        }

        return $missing;
    }

    /**
     * @param list<array<string,mixed>> $metrics
     */
    private function runtimeLegacyHotPathCounterCount(array $metrics): int
    {
        $count = 0;
        foreach ($this->runtimeRouteMetrics($metrics) as $metric) {
            foreach (self::RUNTIME_HOT_PATH_COUNTERS as $counter) {
                $count += (int) max(0.0, (float) ($metric[$counter] ?? 0));
            }
        }

        return $count;
    }

    /**
     * @param list<array<string,mixed>> $metrics
     *
     * @return list<array<string,mixed>>
     */
    private function runtimeRouteMetrics(array $metrics): array
    {
        return array_values(array_filter(
            $metrics,
            static fn (array $metric): bool => (float) ($metric['gameplay.runtime_route'] ?? 0.0) > 0.0,
        ));
    }

    /**
     * @param list<array<string,mixed>> $scenarioReports
     *
     * @return array{status:string,failures:list<array<string,mixed>>,checks:array<string,array<string,mixed>>}
     */
    private function evaluatePerformanceGate(array $scenarioReports, bool $requireRuntimeRoute = false): array
    {
        $allCommandMetrics = [];
        $finalDragMetrics = [];
        foreach ($scenarioReports as $scenarioReport) {
            foreach (is_array($scenarioReport['commandMetrics'] ?? null) ? $scenarioReport['commandMetrics'] : [] as $metric) {
                if (!is_array($metric)) {
                    continue;
                }
                $allCommandMetrics[] = $metric;
                if (($metric['scenario'] ?? null) === 'ws_drag_final_batch') {
                    $finalDragMetrics[] = $metric;
                }
            }
        }
        $simpleMetrics = array_values(array_filter(
            $allCommandMetrics,
            static fn (array $metric): bool => in_array((string) ($metric['command.type'] ?? ''), self::SIMPLE_COMMAND_TYPES, true),
        ));
        $runtimeRouteMetrics = $this->runtimeRouteMetrics($allCommandMetrics);

        $checks = [
            'simple_command_apply_p95_ms' => $this->gateCheck('simple_command_apply_p95_ms', $this->percentile($simpleMetrics, 'command_apply_ms', 95), count($simpleMetrics) > 0),
            'simple_total_server_p95_ms' => $this->gateCheck('simple_total_server_p95_ms', $this->percentile($simpleMetrics, 'total_server_ms', 95), count($simpleMetrics) > 0),
            'simple_patch_bytes_max' => $this->gateCheck('simple_patch_bytes_max', $this->maxValue($simpleMetrics, 'patch_bytes'), count($simpleMetrics) > 0),
            'resync_rate' => $this->gateCheck('resync_rate', count($allCommandMetrics) > 0 ? count(array_filter($allCommandMetrics, static fn (array $metric): bool => (bool) ($metric['resync_required'] ?? false))) / count($allCommandMetrics) : 0.0, count($allCommandMetrics) > 0),
            'event_append_p95_ms' => $this->gateCheck('event_append_p95_ms', $this->percentile($allCommandMetrics, 'event_append_ms', 95, fallbackKey: 'persist_ms'), count($allCommandMetrics) > 0),
            'position_commands_per_drag_max' => $this->gateCheck('position_commands_per_drag_max', $this->maxValue($finalDragMetrics, 'position.commands_per_drag'), count($finalDragMetrics) > 0),
            'full_scan_count_max' => $this->gateCheck('full_scan_count_max', $this->maxValue($allCommandMetrics, 'full_scan_count'), count($allCommandMetrics) > 0),
            'snapshot_full_write_count_max' => $this->gateCheck('snapshot_full_write_count_max', $this->maxValue($allCommandMetrics, 'snapshot_full_write_count'), count($allCommandMetrics) > 0),
            'runtime_failure_count_max' => $this->gateCheck('runtime_failure_count_max', (float) $this->runtimeFailureCount($allCommandMetrics), count($allCommandMetrics) > 0),
            'runtime_fallback_count_max' => $this->gateCheck('runtime_fallback_count_max', (float) $this->runtimeFallbackCount($allCommandMetrics), count($allCommandMetrics) > 0),
            'runtime_route_records_min' => $this->gateCheck('runtime_route_records_min', (float) count($runtimeRouteMetrics), $requireRuntimeRoute && count($allCommandMetrics) > 0),
            'zero_total_server_count_max' => $this->gateCheck('zero_total_server_count_max', (float) $this->zeroTotalServerCount($allCommandMetrics), count($allCommandMetrics) > 0),
            'runtime_hot_path_counter_missing_count_max' => $this->gateCheck(
                'runtime_hot_path_counter_missing_count_max',
                (float) $this->runtimeHotPathCounterMissingCount($allCommandMetrics),
                count($runtimeRouteMetrics) > 0,
            ),
            'runtime_legacy_hot_path_counter_count_max' => $this->gateCheck(
                'runtime_legacy_hot_path_counter_count_max',
                (float) $this->runtimeLegacyHotPathCounterCount($allCommandMetrics),
                count($runtimeRouteMetrics) > 0,
            ),
        ];
        $failures = array_values(array_filter($checks, static fn (array $check): bool => ($check['status'] ?? null) === 'fail'));

        return [
            'status' => $failures === [] ? 'pass' : 'fail',
            'failures' => $failures,
            'checks' => $checks,
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function gateCheck(string $targetKey, float $actual, bool $measured): array
    {
        $target = self::PERFORMANCE_TARGETS[$targetKey];
        $limit = (float) $target['limit'];
        $operator = (string) $target['operator'];
        $passed = !$measured || match ($operator) {
            '<=' => $actual <= $limit,
            '>' => $actual > $limit,
            default => $actual < $limit,
        };

        return [
            'key' => $targetKey,
            'label' => $target['label'],
            'severity' => $target['severity'],
            'operator' => $operator,
            'limit' => $limit,
            'actual' => round($actual, 4),
            'measured' => $measured,
            'status' => !$measured ? 'skipped' : ($passed ? 'pass' : 'fail'),
        ];
    }

    /**
     * @param list<array<string,mixed>> $currentScenarioReports
     *
     * @return array<string,mixed>|null
     */
    private function compareReports(string $previousReportPath, array $currentScenarioReports): ?array
    {
        if (!is_file($previousReportPath)) {
            return ['status' => 'missing_previous_report', 'path' => $previousReportPath, 'scenarios' => []];
        }

        $previous = json_decode((string) file_get_contents($previousReportPath), true);
        if (!is_array($previous)) {
            return ['status' => 'invalid_previous_report', 'path' => $previousReportPath, 'scenarios' => []];
        }

        $previousByName = [];
        foreach (is_array($previous['scenarios'] ?? null) ? $previous['scenarios'] : [] as $scenario) {
            if (is_array($scenario) && is_string($scenario['name'] ?? null)) {
                $previousByName[$scenario['name']] = $scenario;
            }
        }

        $comparisons = [];
        foreach ($currentScenarioReports as $current) {
            $name = (string) ($current['name'] ?? '');
            $before = is_array($previousByName[$name]['summary'] ?? null) ? $previousByName[$name]['summary'] : null;
            $after = is_array($current['summary'] ?? null) ? $current['summary'] : [];
            if ($name === '' || $before === null) {
                continue;
            }
            $comparisons[$name] = [
                'p95_total_server_ms_delta' => round((float) ($after['p95_total_server_ms'] ?? 0) - (float) ($before['p95_total_server_ms'] ?? 0), 2),
                'avg_patch_bytes_delta' => round((float) ($after['avg_patch_bytes'] ?? 0) - (float) ($before['avg_patch_bytes'] ?? 0), 2),
                'avg_memory_peak_bytes_delta' => round((float) ($after['avg_memory_peak_bytes'] ?? 0) - (float) ($before['avg_memory_peak_bytes'] ?? 0), 2),
                'avg_io_write_bytes_delta' => round((float) ($after['avg_io_write_bytes'] ?? 0) - (float) ($before['avg_io_write_bytes'] ?? 0), 2),
                'resync_count_delta' => (int) ($after['resync_count'] ?? 0) - (int) ($before['resync_count'] ?? 0),
            ];
        }

        return ['status' => 'compared', 'path' => $previousReportPath, 'scenarios' => $comparisons];
    }

    /**
     * @param array<string,mixed> $gate
     */
    private function exitCode(InputInterface $input, array $gate, bool $strictTargets): int
    {
        if (!(bool) $input->getOption('fail-on-regression')) {
            return Command::SUCCESS;
        }

        foreach (is_array($gate['failures'] ?? null) ? $gate['failures'] : [] as $failure) {
            if (!is_array($failure)) {
                continue;
            }
            if (($failure['severity'] ?? null) === 'critical' || $strictTargets) {
                return Command::FAILURE;
            }
        }

        return Command::SUCCESS;
    }

    /**
     * @param list<array<string,mixed>> $scenarioReports
     */
    private function renderTable(OutputInterface $output, array $scenarioReports, int $iterations, string $outputPath, string $rawOutputPath, array $gate, ?array $comparison): void
    {
        $output->writeln(sprintf('Gameplay baseline complete. Iterations per scenario: %d', $iterations));
        if ($outputPath !== '') {
            $output->writeln(sprintf('JSON report: %s', $outputPath));
        }
        if ($rawOutputPath !== '') {
            $output->writeln(sprintf('Raw metrics: %s', $rawOutputPath));
        }
        $output->writeln('');
        $output->writeln('Scenario | Kind | Samples | Avg ms | P95 ms | Avg patch bytes | Resyncs | Duplicates');
        $output->writeln('--- | --- | ---: | ---: | ---: | ---: | ---: | ---:');

        foreach ($scenarioReports as $scenarioReport) {
            $summary = is_array($scenarioReport['summary'] ?? null) ? $scenarioReport['summary'] : [];
            $samples = $scenarioReport['kind'] === 'snapshot'
                ? count($scenarioReport['snapshotMetrics'] ?? [])
                : count($scenarioReport['commandMetrics'] ?? []);
            $avgPatchBytes = $scenarioReport['kind'] === 'snapshot'
                ? 0.0
                : (float) ($summary['avg_patch_bytes'] ?? 0.0);
            $resyncs = $scenarioReport['kind'] === 'snapshot'
                ? 0
                : (int) ($summary['resync_count'] ?? 0);
            $duplicates = $scenarioReport['kind'] === 'snapshot'
                ? 0
                : (int) ($summary['duplicate_count'] ?? 0);
            $output->writeln(sprintf(
                '%s | %s | %d | %.2f | %.2f | %.2f | %d | %d',
                $scenarioReport['name'],
                $scenarioReport['kind'],
                $samples,
                (float) ($summary['avg_total_server_ms'] ?? 0.0),
                (float) ($summary['p95_total_server_ms'] ?? 0.0),
                $avgPatchBytes,
                $resyncs,
                $duplicates,
            ));
        }

        $output->writeln('');
        $output->writeln(sprintf('Performance gate: %s', strtoupper((string) ($gate['status'] ?? 'unknown'))));
        foreach (is_array($gate['checks'] ?? null) ? $gate['checks'] : [] as $check) {
            if (!is_array($check)) {
                continue;
            }
            $output->writeln(sprintf(
                '- %s [%s]: %s actual=%s target=%s %s',
                $check['label'] ?? $check['key'] ?? 'check',
                $check['severity'] ?? 'unknown',
                $check['status'] ?? 'unknown',
                (string) ($check['actual'] ?? 'n/a'),
                (string) ($check['operator'] ?? ''),
                (string) ($check['limit'] ?? ''),
            ));
        }
        if (is_array($comparison) && ($comparison['status'] ?? null) === 'compared') {
            $output->writeln('');
            $output->writeln(sprintf('Compared with: %s', (string) ($comparison['path'] ?? '')));
        }
    }
}
