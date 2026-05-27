<?php

namespace App\Tests\Application;

use App\Application\Card\CardLocalizationService;
use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameProjectionService;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class GameProjectionServiceTest extends TestCase
{
    public function testOpponentHandProjectionCentersRevealedCardsWithoutLeakingOriginalPosition(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $viewer = new User('viewer@example.test', 'Viewer');
        $snapshot = $this->snapshot($owner->id(), $viewer->id());

        $projected = (new GameProjectionService(new GameCommandHandler()))->projectSnapshot($snapshot, $viewer);
        $hand = $projected['players'][$owner->id()]['zones']['hand'];

        self::assertCount(5, $hand);
        self::assertSame('Hidden card', $hand[0]['name']);
        self::assertTrue($hand[0]['hidden']);
        self::assertSame('Hidden card', $hand[1]['name']);
        self::assertTrue($hand[1]['hidden']);
        self::assertSame('Revealed Tutor', $hand[2]['name']);
        self::assertSame([$viewer->id()], $hand[2]['revealedTo']);
        self::assertArrayNotHasKey('hidden', $hand[2]);
        self::assertSame('Hidden card', $hand[3]['name']);
        self::assertTrue($hand[3]['hidden']);
        self::assertSame('Hidden card', $hand[4]['name']);
        self::assertTrue($hand[4]['hidden']);
    }

    public function testOpponentLibraryProjectionShowsOnlyTopRevealTargetTheRealCard(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $target = new User('target@example.test', 'Target');
        $other = new User('other@example.test', 'Other');
        $snapshot = $this->snapshot($owner->id(), $target->id());
        $snapshot['players'][$other->id()] = $this->player($other->id(), []);
        $snapshot['players'][$owner->id()]['zones']['library'] = [
            [
                ...$this->card('top-card', 'Revealed Top'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'library',
                'revealedTo' => [$target->id()],
            ],
            [
                ...$this->card('second-card', 'Private Second'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'library',
            ],
        ];
        $projection = new GameProjectionService(new GameCommandHandler());

        $targetLibrary = $projection->projectSnapshot($snapshot, $target)['players'][$owner->id()]['zones']['library'];
        $otherLibrary = $projection->projectSnapshot($snapshot, $other)['players'][$owner->id()]['zones']['library'];

        self::assertCount(1, $targetLibrary);
        self::assertSame('Revealed Top', $targetLibrary[0]['name']);
        self::assertArrayNotHasKey('hidden', $targetLibrary[0]);
        self::assertCount(1, $otherLibrary);
        self::assertSame('Hidden card', $otherLibrary[0]['name']);
        self::assertTrue($otherLibrary[0]['hidden']);
        self::assertTrue($otherLibrary[0]['faceDown']);
    }

    public function testOpponentLibraryProjectionShowsOnlyTopCardWhenPlayTopRevealedIsActive(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $viewer = new User('viewer@example.test', 'Viewer');
        $snapshot = $this->snapshot($owner->id(), $viewer->id());
        $snapshot['players'][$owner->id()]['playTopLibraryRevealed'] = true;
        $snapshot['players'][$owner->id()]['zones']['library'] = [
            [
                ...$this->card('top-card', 'Public Top'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'library',
            ],
            [
                ...$this->card('second-card', 'Private Second'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'library',
                'revealedTo' => ['all'],
            ],
        ];

        $library = (new GameProjectionService(new GameCommandHandler()))
            ->projectSnapshot($snapshot, $viewer)['players'][$owner->id()]['zones']['library'];

        self::assertCount(1, $library);
        self::assertSame('Public Top', $library[0]['name']);
        self::assertArrayNotHasKey('hidden', $library[0]);
    }

    public function testOpponentLibraryZoneProjectionShowsFullLibraryOnlyWhenCardsAreRevealedToViewer(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $viewer = new User('viewer@example.test', 'Viewer');
        $cards = [
            [
                ...$this->card('top-card', 'Public Top'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'library',
                'faceDown' => true,
                'revealedTo' => [$viewer->id()],
            ],
            [
                ...$this->card('second-card', 'Public Second'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'library',
                'faceDown' => true,
                'revealedTo' => [$viewer->id()],
            ],
        ];

        $library = (new GameProjectionService(new GameCommandHandler()))
            ->projectZone($cards, $owner->id(), 'library', $viewer);

        self::assertCount(2, $library);
        self::assertSame('Public Top', $library[0]['name']);
        self::assertSame('Public Second', $library[1]['name']);
        self::assertFalse($library[0]['faceDown']);
        self::assertFalse($library[1]['faceDown']);
    }

    public function testOpponentLibraryZoneProjectionDoesNotLeakFullRevealToOtherPlayers(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $target = new User('target@example.test', 'Target');
        $other = new User('other@example.test', 'Other');
        $cards = [
            [
                ...$this->card('top-card', 'Target Top'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'library',
                'revealedTo' => [$target->id()],
            ],
            [
                ...$this->card('second-card', 'Target Second'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'library',
                'revealedTo' => [$target->id()],
            ],
        ];

        $library = (new GameProjectionService(new GameCommandHandler()))
            ->projectZone($cards, $owner->id(), 'library', $other);

        self::assertCount(1, $library);
        self::assertSame('Hidden card', $library[0]['name']);
        self::assertTrue($library[0]['hidden']);
    }

    public function testProjectionUntapsLegacyCardsOutsideBattlefield(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $viewer = new User('viewer@example.test', 'Viewer');
        $snapshot = $this->snapshot($owner->id(), $viewer->id());
        $snapshot['players'][$owner->id()]['zones']['hand'] = [
            [
                ...$this->card('legacy-tapped-hand', 'Legacy Tapped Hand'),
                'tapped' => true,
                'rotation' => 90,
            ],
        ];

        $hand = (new GameProjectionService(new GameCommandHandler()))
            ->projectSnapshot($snapshot, $owner)['players'][$owner->id()]['zones']['hand'];

        self::assertFalse($hand[0]['tapped']);
        self::assertSame(0, $hand[0]['rotation']);
    }

    public function testProjectionLocalizesVisibleCardsPerViewerLanguageWithoutLeakingHiddenZones(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $spanishViewer = new User('spanish@example.test', 'Spanish');
        $frenchViewer = new User('french@example.test', 'French');
        $spanishViewer->updateCardLanguage('es');
        $frenchViewer->updateCardLanguage('fr');

        $snapshot = $this->snapshot($owner->id(), $spanishViewer->id());
        $snapshot['players'][$frenchViewer->id()] = $this->player($frenchViewer->id(), []);
        $snapshot['players'][$owner->id()]['zones']['battlefield'] = [[
            ...$this->card('public-card', 'Sol Ring'),
            'ownerId' => $owner->id(),
            'controllerId' => $owner->id(),
            'zone' => 'battlefield',
            'scryfallId' => 'sol-ring-print',
            'revealedTo' => ['all'],
        ]];
        $snapshot['players'][$owner->id()]['zones']['hand'] = [[
            ...$this->card('hidden-hand', 'Private Spell'),
            'ownerId' => $owner->id(),
            'controllerId' => $owner->id(),
            'zone' => 'hand',
            'scryfallId' => 'private-print',
        ]];

        $localization = $this->getMockBuilder(CardLocalizationService::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['primeForLanguage', 'localizeCardPayload'])
            ->getMock();
        $localization
            ->method('localizeCardPayload')
            ->willReturnCallback(static function (array $card, ?string $language, bool $preserveIdentity): array {
                if ($preserveIdentity && ($card['scryfallId'] ?? null) === 'sol-ring-print') {
                    $card['name'] = $language === 'es' ? 'Anillo solar' : ($language === 'fr' ? 'Anneau solaire' : $card['name']);
                }

                return $card;
            });

        $projection = new GameProjectionService(new GameCommandHandler(), $localization);

        $spanishProjection = $projection->projectSnapshot($snapshot, $spanishViewer);
        $frenchProjection = $projection->projectSnapshot($snapshot, $frenchViewer);

        self::assertSame('Anillo solar', $spanishProjection['players'][$owner->id()]['zones']['battlefield'][0]['name']);
        self::assertSame('Anneau solaire', $frenchProjection['players'][$owner->id()]['zones']['battlefield'][0]['name']);
        self::assertSame('Hidden card', $spanishProjection['players'][$owner->id()]['zones']['hand'][0]['name']);
        self::assertSame('Hidden card', $frenchProjection['players'][$owner->id()]['zones']['hand'][0]['name']);
    }

    public function testProjectedSnapshotPreservesGameplayContractFieldsForUiBootstrap(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $viewer = new User('viewer@example.test', 'Viewer');
        $snapshot = $this->snapshot($owner->id(), $viewer->id());
        $snapshot['updatedAt'] = '2026-01-01T00:01:00+00:00';
        $snapshot['counters'] = ['global' => ['storm' => 2]];
        $snapshot['stack'] = [[
            'id' => 'stack-1',
            'kind' => 'card',
            'card' => [
                ...$this->card('stack-card', 'Stack Spell'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'battlefield',
            ],
            'createdAt' => '2026-01-01T00:00:10+00:00',
        ]];
        $snapshot['arrows'] = [[
            'id' => 'arrow-1',
            'ownerId' => $owner->id(),
            'fromInstanceId' => 'face-down-permanent',
            'toInstanceId' => 'public-permanent',
            'color' => 'yellow',
            'createdAt' => '2026-01-01T00:00:20+00:00',
        ]];
        $snapshot['attachments'] = [[
            'id' => 'attachment-1',
            'ownerId' => $owner->id(),
            'equipmentInstanceId' => 'face-down-permanent',
            'attachedToInstanceId' => 'public-permanent',
            'createdAt' => '2026-01-01T00:00:30+00:00',
        ]];
        $snapshot['chat'] = [[
            'userId' => $owner->id(),
            'displayName' => 'Owner',
            'message' => 'public message',
            'targetPlayerId' => null,
            'targetDisplayName' => null,
            'createdAt' => '2026-01-01T00:00:40+00:00',
        ]];
        $snapshot['eventLog'] = [[
            'id' => 'log-1',
            'type' => 'zone.random_card.selected',
            'message' => 'Selected Public Permanent.',
            'actorId' => $owner->id(),
            'displayName' => 'Owner',
            'cardInstanceId' => 'public-permanent',
            'cardPlayerId' => $owner->id(),
            'cardZone' => 'battlefield',
            'createdAt' => '2026-01-01T00:00:50+00:00',
        ]];

        $snapshot['players'][$owner->id()] = [
            ...$snapshot['players'][$owner->id()],
            'backgroundName' => 'U_2',
            'sleevesName' => 'facedown_card',
            'colorIdentity' => ['U'],
            'commanderDamage' => [$viewer->id() => 4],
            'counters' => ['poison' => 1],
        ];
        $snapshot['players'][$owner->id()]['zones']['library'] = [[
            ...$this->card('library-top', 'Private Top'),
            'ownerId' => $owner->id(),
            'controllerId' => $owner->id(),
            'zone' => 'library',
            'revealedTo' => ['another-player'],
        ]];
        $snapshot['players'][$owner->id()]['zones']['battlefield'] = [
            [
                ...$this->card('face-down-permanent', 'Hidden Permanent'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'battlefield',
                'tapped' => true,
                'faceDown' => true,
                'position' => ['x' => 0.25, 'y' => 0.75, 'unit' => 'ratio'],
                'rotation' => 90,
                'counters' => ['shield' => 1],
            ],
            [
                ...$this->card('public-permanent', 'Public Permanent'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'battlefield',
                'faceDown' => false,
                'position' => ['x' => 0.5, 'y' => 0.5, 'unit' => 'ratio'],
                'revealedTo' => [$viewer->id()],
            ],
        ];

        $projected = (new GameProjectionService(new GameCommandHandler()))->projectSnapshot($snapshot, $viewer);
        $ownerProjection = $projected['players'][$owner->id()];

        self::assertSame(1, $projected['version']);
        self::assertSame($owner->id(), $projected['ownerId']);
        self::assertSame($snapshot['turn'], $projected['turn']);
        self::assertSame($snapshot['timer'] ?? null, $projected['timer'] ?? null);
        self::assertSame($snapshot['stack'], $projected['stack']);
        self::assertSame($snapshot['arrows'], $projected['arrows']);
        self::assertSame($snapshot['attachments'], $projected['attachments']);
        self::assertSame($snapshot['chat'], $projected['chat']);
        self::assertSame($snapshot['eventLog'], $projected['eventLog']);
        self::assertSame($snapshot['counters'], $projected['counters']);
        self::assertSame('2026-01-01T00:00:00+00:00', $projected['createdAt']);
        self::assertSame('2026-01-01T00:01:00+00:00', $projected['updatedAt']);

        self::assertSame('U_2', $ownerProjection['backgroundName']);
        self::assertSame('facedown_card', $ownerProjection['sleevesName']);
        self::assertSame(['U'], $ownerProjection['colorIdentity']);
        self::assertSame([$viewer->id() => 4], $ownerProjection['commanderDamage']);
        self::assertSame(['poison' => 1], $ownerProjection['counters']);
        self::assertSame(['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'], array_keys($ownerProjection['zones']));
        self::assertSame(1, $ownerProjection['zoneCounts']['library']);
        self::assertSame(5, $ownerProjection['zoneCounts']['hand']);
        self::assertSame(2, $ownerProjection['zoneCounts']['battlefield']);

        $libraryTop = $ownerProjection['zones']['library'][0];
        self::assertSame('Hidden card', $libraryTop['name']);
        self::assertSame($owner->id(), $libraryTop['ownerId']);
        self::assertSame($owner->id(), $libraryTop['controllerId']);
        self::assertTrue($libraryTop['hidden']);
        self::assertTrue($libraryTop['faceDown']);
        self::assertSame('library', $libraryTop['zone']);

        $faceDown = $ownerProjection['zones']['battlefield'][0];
        self::assertSame('Face-down card', $faceDown['name']);
        self::assertSame($owner->id(), $faceDown['ownerId']);
        self::assertSame($owner->id(), $faceDown['controllerId']);
        self::assertTrue($faceDown['hidden']);
        self::assertTrue($faceDown['tapped']);
        self::assertTrue($faceDown['faceDown']);
        self::assertSame(['x' => 0.25, 'y' => 0.75, 'unit' => 'ratio'], $faceDown['position']);
        self::assertSame(90, $faceDown['rotation']);
        self::assertSame(['shield' => 1], $faceDown['counters']);

        $publicPermanent = $ownerProjection['zones']['battlefield'][1];
        self::assertSame('public-permanent', $publicPermanent['instanceId']);
        self::assertSame($viewer->id(), $publicPermanent['revealedTo'][0]);
        self::assertFalse($publicPermanent['faceDown']);
    }

    private function snapshot(string $ownerId, string $viewerId): array
    {
        return [
            'version' => 1,
            'ownerId' => $ownerId,
            'players' => [
                $ownerId => $this->player($ownerId, [
                    [
                        ...$this->card('revealed-card', 'Revealed Tutor'),
                        'revealedTo' => [$viewerId],
                    ],
                    $this->card('hidden-before', 'Private Tutor'),
                    $this->card('hidden-after', 'Private Removal'),
                    $this->card('hidden-third', 'Private Ramp'),
                    $this->card('hidden-fourth', 'Private Land'),
                ]),
                $viewerId => $this->player($viewerId, []),
            ],
            'turn' => ['activePlayerId' => $ownerId, 'phase' => 'main', 'number' => 1],
            'stack' => [],
            'arrows' => [],
            'chat' => [],
            'eventLog' => [],
            'createdAt' => '2026-01-01T00:00:00+00:00',
        ];
    }

    /**
     * @param list<array<string,mixed>> $hand
     *
     * @return array<string,mixed>
     */
    private function player(string $playerId, array $hand): array
    {
        return [
            'user' => ['id' => $playerId, 'email' => $playerId.'@example.test', 'displayName' => $playerId, 'roles' => []],
            'life' => 40,
            'zones' => [
                'library' => [],
                'hand' => $hand,
                'battlefield' => [],
                'graveyard' => [],
                'exile' => [],
                'command' => [],
            ],
            'commanderDamage' => [],
            'counters' => [],
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function card(string $instanceId, string $name): array
    {
        return [
            'instanceId' => $instanceId,
            'ownerId' => null,
            'controllerId' => null,
            'name' => $name,
            'zone' => 'hand',
            'tapped' => false,
            'revealedTo' => [],
            'imageUris' => ['normal' => 'https://cards.example/'.$instanceId.'.jpg'],
        ];
    }
}
