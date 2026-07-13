<?php

namespace App\Tests\Application;

use App\Application\Game\Compact\CardInstanceRuntime;
use App\Application\Game\Compact\PowerToughnessModel;
use App\Application\Game\GameEventReplayService;
use App\Application\Game\GameCommandHandler;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Room\Room;
use App\Domain\User\User;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class PowerToughnessModelTest extends TestCase
{
    #[DataProvider('printedValues')]
    public function testClassifierPreservesPrintedValueWithoutDestructiveConversion(mixed $value, ?string $normalized, string $kind): void
    {
        self::assertSame(['value' => $normalized, 'kind' => $kind], PowerToughnessModel::classify($value));
    }

    public static function printedValues(): iterable
    {
        yield ['0', '0', PowerToughnessModel::NUMERIC];
        yield ['+3', '+3', PowerToughnessModel::NUMERIC];
        yield ['1.5', '1.5', PowerToughnessModel::NUMERIC];
        yield ['*', '*', PowerToughnessModel::FORMULA];
        yield ['1+x', '1+X', PowerToughnessModel::FORMULA];
        yield ['?', '?', PowerToughnessModel::SYMBOLIC];
        yield ["\u{221E}", "\u{221E}", PowerToughnessModel::SYMBOLIC];
        yield [null, null, PowerToughnessModel::ABSENT];
    }

    public function testLegacyFormulaZeroIsAbsenceButNumericDifferenceBecomesImportedOverride(): void
    {
        $formula = ['defaultPower' => '*', 'defaultToughness' => '1+*', 'power' => 0, 'toughness' => 0];
        $printedFormula = PowerToughnessModel::printedStats($formula);
        self::assertSame([], PowerToughnessModel::manualOverrides($formula, $printedFormula));

        $numeric = ['defaultPower' => '2', 'defaultToughness' => '3', 'power' => 4.5, 'toughness' => 3];
        $printedNumeric = PowerToughnessModel::printedStats($numeric);
        self::assertSame(4.5, PowerToughnessModel::manualOverrides($numeric, $printedNumeric)['0']['power']);
        self::assertArrayNotHasKey('toughness', PowerToughnessModel::manualOverrides($numeric, $printedNumeric)['0']);
        self::assertSame('imported_legacy', PowerToughnessModel::manualOverrides($numeric, $printedNumeric)['0']['provenance']);
    }

    public function testExplicitNullPrintedDefaultsRemainAbsentInsteadOfFallingBackToMutableValues(): void
    {
        $legacy = ['defaultPower' => null, 'defaultToughness' => null, 'power' => 3, 'toughness' => 4];
        $printed = PowerToughnessModel::printedStats($legacy);

        self::assertNull($printed['0']['power']);
        self::assertNull($printed['0']['toughness']);
        self::assertSame(3, PowerToughnessModel::manualOverrides($legacy, $printed)['0']['power']);
        self::assertSame(4, PowerToughnessModel::manualOverrides($legacy, $printed)['0']['toughness']);
    }

    public function testExplicitZeroIndependentAxesAndDfcRoundTripExactly(): void
    {
        $legacy = [
            'instanceId' => 'dfc-1',
            'cardKey' => 'dfc:card',
            'ownerId' => 'player-1',
            'controllerId' => 'player-1',
            'zone' => 'battlefield',
            'activeFaceIndex' => 1,
            'cardFaces' => [
                ['power' => '*', 'toughness' => '*'],
                ['power' => '1.5', 'toughness' => '2.5'],
            ],
            'manualOverrides' => [
                '0' => ['faceKey' => '0', 'faceIndex' => 0, 'power' => 0, 'provenance' => 'manual'],
                '1' => ['faceKey' => '1', 'faceIndex' => 1, 'toughness' => 4.5, 'provenance' => 'manual'],
            ],
            'counters' => ['+1/+1' => 2],
        ];

        $runtime = CardInstanceRuntime::fromLegacyCard($legacy, 'dfc:card', 'player-1', 'battlefield');
        $roundTrip = $runtime->toArray();

        self::assertSame('*', $roundTrip['printedStats']['0']['power']);
        self::assertSame('1.5', $roundTrip['printedStats']['1']['power']);
        self::assertSame(0, $roundTrip['manualOverrides']['0']['power']);
        self::assertArrayNotHasKey('toughness', $roundTrip['manualOverrides']['0']);
        self::assertSame(4.5, $roundTrip['manualOverrides']['1']['toughness']);
        self::assertSame(['+1/+1' => 2], $roundTrip['counters']);
        self::assertSame(1.5, PowerToughnessModel::activeAxis($roundTrip['printedStats'], $roundTrip['manualOverrides'], 1, 'power'));
        self::assertSame(4.5, PowerToughnessModel::activeAxis($roundTrip['printedStats'], $roundTrip['manualOverrides'], 1, 'toughness'));
    }

    public function testTokenAndCopyProvenanceRemainDistinct(): void
    {
        $token = ['isToken' => true, 'defaultPower' => '*', 'defaultToughness' => '*'];
        self::assertSame('token_creation', PowerToughnessModel::printedStats($token)['0']['provenance']);

        $copy = ['isToken' => true, 'isTokenCopy' => true, 'defaultPower' => '*', 'defaultToughness' => '*'];
        self::assertSame('copy_effect', PowerToughnessModel::printedStats($copy)['0']['provenance']);
    }

    public function testNewReplayCopiesPersistedFinalOverrideAndClearWithoutRecalculation(): void
    {
        $actor = new User('pt-replay@example.test', 'PT Replay');
        $base = [
            'version' => 1,
            'players' => [
                $actor->id() => [
                    'life' => 40,
                    'status' => 'active',
                    'zones' => [
                        'library' => [], 'hand' => [], 'graveyard' => [], 'exile' => [], 'command' => [],
                        'battlefield' => [[
                            'instanceId' => 'formula-1', 'name' => 'Formula', 'zone' => 'battlefield',
                            'ownerId' => $actor->id(), 'controllerId' => $actor->id(), 'activeFaceIndex' => 0,
                            'defaultPower' => '*', 'defaultToughness' => '1+*',
                            'printedStats' => ['0' => ['faceKey' => '0', 'faceIndex' => 0, 'power' => '*', 'toughness' => '1+*', 'provenance' => 'printed']],
                            'manualOverrides' => [], 'counters' => ['+1/+1' => 2],
                        ]],
                    ],
                ],
            ],
        ];
        $game = new Game(new Room($actor), $base);
        $set = new GameEvent($game, 'card.stats.override.set', [
            'effectVersion' => 1,
            'instanceId' => 'formula-1',
            'faceKey' => '0',
            'faceIndex' => 0,
            'override' => ['faceKey' => '0', 'faceIndex' => 0, 'power' => 0, 'provenance' => 'manual', 'updatedAtVersion' => 2],
        ], $actor, 'pt-set', 2);
        $afterSet = (new GameEventReplayService())->replay($base, [$set]);
        $card = $afterSet['players'][$actor->id()]['zones']['battlefield'][0];
        self::assertSame(0, $card['manualOverrides']['0']['power']);
        self::assertSame(0, $card['power']);
        self::assertSame('1+*', $card['toughness']);
        self::assertSame(['+1/+1' => 2], $card['counters']);

        $clear = new GameEvent($game, 'card.stats.override.cleared', [
            'effectVersion' => 1,
            'instanceId' => 'formula-1',
            'faceKey' => '0',
            'faceIndex' => 0,
            'override' => null,
        ], $actor, 'pt-clear', 3);
        $afterClear = (new GameEventReplayService())->replay($afterSet, [$clear]);
        $card = $afterClear['players'][$actor->id()]['zones']['battlefield'][0];
        self::assertArrayNotHasKey('0', $card['manualOverrides']);
        self::assertSame('*', $card['power']);
        self::assertSame('1+*', $card['toughness']);
        self::assertSame(['+1/+1' => 2], $card['counters']);
    }

	public function testTokenReplayKeepsPrintedFormulaAcrossOverrideCounterAndClear(): void
	{
		$actor = new User('pt-token-replay@example.test', 'PT Token Replay');
		$base = [
			'version' => 1,
			'players' => [
				$actor->id() => [
					'life' => 40,
					'status' => 'active',
					'zones' => [
						'library' => [], 'hand' => [], 'graveyard' => [], 'exile' => [], 'command' => [], 'battlefield' => [],
					],
				],
			],
		];
		$game = new Game(new Room($actor), $base);
		$printed = ['0' => [
			'faceKey' => '0', 'faceIndex' => 0, 'power' => '*', 'toughness' => '1+*', 'provenance' => 'token_creation',
		]];
		$events = [
			new GameEvent($game, 'card.token.created', [
				'playerId' => $actor->id(),
				'tokens' => [[
					'instanceId' => 'token-formula', 'cardKey' => 'token:formula', 'name' => 'Formula Token',
					'ownerId' => $actor->id(), 'controllerId' => $actor->id(), 'power' => '*', 'toughness' => '1+*',
					'printedStats' => $printed, 'manualOverrides' => null, 'counters' => [],
				]],
			], $actor, 'token-create', 2),
			new GameEvent($game, 'card.stats.override.set', [
				'effectVersion' => 1, 'instanceId' => 'token-formula', 'faceKey' => '0', 'faceIndex' => 0,
				'override' => ['faceKey' => '0', 'faceIndex' => 0, 'power' => 0, 'toughness' => 0, 'provenance' => 'manual'],
			], $actor, 'token-set', 3),
			new GameEvent($game, 'card.counter.changed', [
				'instanceId' => 'token-formula', 'counters' => ['+1/+1' => 1],
			], $actor, 'token-counter', 4),
			new GameEvent($game, 'card.stats.override.cleared', [
				'effectVersion' => 1, 'instanceId' => 'token-formula', 'faceKey' => '0', 'faceIndex' => 0, 'override' => [],
			], $actor, 'token-clear', 5),
		];

		$replayed = (new GameEventReplayService())->replay($base, $events);
		$replayed = (new GameCommandHandler())->normalizeSnapshot($replayed);
		$card = $replayed['players'][$actor->id()]['zones']['battlefield'][0];
		self::assertSame('*', $card['printedStats']['0']['power']);
		self::assertSame('*', $card['power']);
		self::assertSame('1+*', $card['toughness']);
		self::assertSame(['+1/+1' => 1], $card['counters']);
	}

	public function testLegacyPowerToughnessEventImportsExplicitOverrideWithoutChangingHistory(): void
	{
		$actor = new User('pt-legacy-event@example.test', 'PT Legacy Event');
		$base = [
			'version' => 1,
			'players' => [$actor->id() => ['zones' => [
				'library' => [], 'hand' => [], 'graveyard' => [], 'exile' => [], 'command' => [],
				'battlefield' => [[
					'instanceId' => 'legacy-stat', 'ownerId' => $actor->id(), 'controllerId' => $actor->id(),
					'zone' => 'battlefield', 'power' => null, 'toughness' => null,
					'printedStats' => ['0' => ['faceKey' => '0', 'faceIndex' => 0, 'power' => null, 'toughness' => null]],
					'manualOverrides' => [],
				]],
			]]],
		];
		$game = new Game(new Room($actor), $base);
		$event = new GameEvent($game, 'card.power_toughness.changed', [
			'instanceId' => 'legacy-stat', 'power' => 5, 'toughness' => 7,
		], $actor, 'legacy-stat-change', 2);

		$replayed = (new GameEventReplayService())->replay($base, [$event]);
		$replayed = (new GameCommandHandler())->normalizeSnapshot($replayed);
		$card = $replayed['players'][$actor->id()]['zones']['battlefield'][0];
		self::assertSame(5, $card['power']);
		self::assertSame(7, $card['toughness']);
		self::assertSame('imported_legacy', $card['manualOverrides']['0']['provenance']);
	}
}
