<?php

namespace App\Tests\Application;

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
