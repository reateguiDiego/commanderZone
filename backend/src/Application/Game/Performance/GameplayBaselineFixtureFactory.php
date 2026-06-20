<?php

namespace App\Application\Game\Performance;

use App\Domain\Game\Game;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;

final class GameplayBaselineFixtureFactory
{
    public function create(string $slug): GameplayBaselineFixture
    {
        $suffix = substr(preg_replace('/[^a-z0-9]/i', '', $slug) ?: 'perf', -8);
        $owner = $this->user(sprintf('%s-owner@example.test', $slug), sprintf('Owner%s', $suffix));
        $alpha = $this->user(sprintf('%s-alpha@example.test', $slug), sprintf('Alpha%s', $suffix));
        $beta = $this->user(sprintf('%s-beta@example.test', $slug), sprintf('Beta%s', $suffix));
        $gamma = $this->user(sprintf('%s-gamma@example.test', $slug), sprintf('Gamma%s', $suffix));

        $room = new Room($owner);
        $room->setVisibility(Room::VISIBILITY_PRIVATE);
        $room->setStartingLife(40);
        foreach ([$owner, $alpha, $beta, $gamma] as $user) {
            $room->addPlayer(new RoomPlayer($room, $user));
        }

        $usersByKey = [
            'p1' => $owner,
            'p2' => $alpha,
            'p3' => $beta,
            'p4' => $gamma,
        ];

        $playerSnapshots = [];
        $battlefieldInstanceIdsByKey = [];
        $libraryTopInstanceIdsByKey = [];

        $index = 0;
        foreach ($usersByKey as $key => $user) {
            $index++;
            $playerId = $user->id();
            $zones = $this->zonesForPlayer($key, $playerId, $index);
            $battlefieldInstanceIdsByKey[$key] = array_values(array_map(
                static fn (array $card): string => (string) $card['instanceId'],
                $zones['battlefield'],
            ));
            $libraryTopInstanceIdsByKey[$key] = array_values(array_map(
                static fn (array $card): string => (string) $card['instanceId'],
                array_slice($zones['library'], 0, 10),
            ));
            $playerSnapshots[$playerId] = [
                'user' => $user->toArray(),
                'status' => 'active',
                'concededAt' => null,
                'deckName' => sprintf('Performance Deck %d', $index),
                'colorIdentity' => $this->colorIdentityForPlayer($index),
                'backgroundName' => sprintf('%s_%d', ['W', 'U', 'B', 'R'][$index - 1], $index),
                'sleevesName' => 'default',
                'life' => 40 - ($index - 1),
                'playTopLibraryRevealed' => false,
                'revealedLibraryTo' => [],
                'zones' => $zones,
                'zoneCounts' => array_map('count', $zones),
                'commanderDamage' => [],
                'counters' => [],
            ];
        }

        foreach ($playerSnapshots as $targetPlayerId => &$playerSnapshot) {
            foreach ($playerSnapshots as $sourcePlayerId => $sourcePlayerSnapshot) {
                if ($targetPlayerId === $sourcePlayerId) {
                    continue;
                }

                foreach ($sourcePlayerSnapshot['zones']['command'] as $commander) {
                    $playerSnapshot['commanderDamage'][(string) $commander['instanceId']] = 0;
                }
            }
        }
        unset($playerSnapshot);

        $createdAt = '2026-01-01T00:00:00+00:00';
        $snapshot = [
            'version' => 1,
            'ownerId' => $owner->id(),
            'gamePhase' => 'PLAYING',
            'mulligan' => [
                'rule' => Room::DEFAULT_MULLIGAN_RULE,
                'firstMulliganFree' => true,
            ],
            'players' => $playerSnapshots,
            'turn' => [
                'activePlayerId' => $owner->id(),
                'phase' => 'main-1',
                'number' => 8,
            ],
            'timer' => [
                'mode' => Room::TIMER_NONE,
                'durationSeconds' => null,
                'remainingSeconds' => null,
                'status' => 'idle',
            ],
            'stack' => [],
            'arrows' => [],
            'attachments' => [],
            'specialEntities' => [],
            'chat' => $this->chatLog($usersByKey),
            'eventLog' => $this->eventLog($usersByKey),
            'createdAt' => $createdAt,
            'updatedAt' => $createdAt,
        ];

        $game = new Game($room, $snapshot);
        $room->start($game);

        return new GameplayBaselineFixture(
            $game,
            $usersByKey,
            array_combine(array_keys($usersByKey), array_map(static fn (User $user): string => $user->id(), $usersByKey)),
            $battlefieldInstanceIdsByKey,
            $libraryTopInstanceIdsByKey,
        );
    }

    private function user(string $email, string $displayName): User
    {
        $user = new User($email, $displayName);
        $user->setPassword('Password123');
        $user->markEmailVerified();

        return $user;
    }

    /**
     * @return array{library:list<array<string,mixed>>,hand:list<array<string,mixed>>,battlefield:list<array<string,mixed>>,graveyard:list<array<string,mixed>>,exile:list<array<string,mixed>>,command:list<array<string,mixed>>}
     */
    private function zonesForPlayer(string $key, string $playerId, int $seat): array
    {
        $zones = [
            'library' => [],
            'hand' => [],
            'battlefield' => [],
            'graveyard' => [],
            'exile' => [],
            'command' => [],
        ];

        for ($index = 1; $index <= 60; $index++) {
            $zones['library'][] = $this->cardInstance($key, $playerId, 'library', $index, position: null);
        }
        for ($index = 61; $index <= 67; $index++) {
            $zones['hand'][] = $this->cardInstance($key, $playerId, 'hand', $index, position: null);
        }
        for ($index = 68; $index <= 87; $index++) {
            $card = $this->cardInstance(
                $key,
                $playerId,
                'battlefield',
                $index,
                ['x' => round((($index - 67) % 5) * 0.18 + 0.08, 4), 'y' => round((int) floor(($index - 68) / 5) * 0.14 + 0.12, 4), 'unit' => 'ratio'],
            );
            if ($index >= 86) {
                $card['isToken'] = true;
                $card['isTokenCopy'] = false;
                $card['name'] = sprintf('%s Token %d', strtoupper($key), $index - 85);
                $card['typeLine'] = 'Token Creature - Soldier';
            }
            if ($index === 84) {
                $card['faceDown'] = true;
            }
            if (($index - 68) % 4 === 0) {
                $card['tapped'] = true;
                $card['rotation'] = 90;
            }
            if (($index - 68) % 6 === 0) {
                $card['counters'] = ['+1/+1' => 2];
            }
            $zones['battlefield'][] = $card;
        }
        for ($index = 88; $index <= 97; $index++) {
            $zones['graveyard'][] = $this->cardInstance($key, $playerId, 'graveyard', $index, position: null);
        }
        for ($index = 98; $index <= 100; $index++) {
            $zones['exile'][] = $this->cardInstance($key, $playerId, 'exile', $index, position: null);
        }

        $zones['command'][] = $this->commanderInstance($key, $playerId, 1, $seat);
        $zones['command'][] = $this->commanderInstance($key, $playerId, 2, $seat);

        $zones['library'][0]['revealedTo'] = ['all'];
        $zones['library'][1]['revealedTo'] = [$playerId];
        $zones['hand'][0]['revealedTo'] = ['all'];

        return $zones;
    }

    /**
     * @return list<string>
     */
    private function colorIdentityForPlayer(int $seat): array
    {
        return match ($seat) {
            1 => ['W', 'U'],
            2 => ['B', 'R'],
            3 => ['G'],
            default => ['U', 'R'],
        };
    }

    /**
     * @return array<string,mixed>
     */
    private function cardInstance(
        string $key,
        string $playerId,
        string $zone,
        int $index,
        ?array $position = ['x' => 0, 'y' => 0],
    ): array {
        $isRatioPosition = is_array($position) && ($position['unit'] ?? null) === 'ratio';

        return [
            'instanceId' => sprintf('%s-%s-%03d', $key, $zone, $index),
            'ownerId' => $playerId,
            'controllerId' => $playerId,
            'scryfallId' => sprintf('perf-%s-%s-%03d', $key, $zone, $index),
            'name' => sprintf('%s %s %03d', strtoupper($key), ucfirst($zone), $index),
            'imageUris' => ['normal' => sprintf('https://cards.example.test/%s/%s/%03d.jpg', $key, $zone, $index)],
            'cardFaces' => [],
            'hasRulings' => ($index % 3) === 0,
            'typeLine' => $zone === 'battlefield' ? 'Creature - Soldier' : 'Sorcery',
            'manaCost' => '{2}{G}',
            'oracleText' => sprintf('Performance oracle text %s %03d.', $key, $index),
            'colorIdentity' => ['G'],
            'power' => 2,
            'toughness' => 2,
            'loyalty' => null,
            'defense' => null,
            'defaultPower' => 2,
            'defaultToughness' => 2,
            'defaultLoyalty' => null,
            'defaultDefense' => null,
            'tapped' => false,
            'faceDown' => false,
            'activeFaceIndex' => 0,
            'revealedTo' => [],
            'position' => $position ?? ($isRatioPosition ? ['x' => 0.5, 'y' => 0.5, 'unit' => 'ratio'] : ['x' => 0, 'y' => 0]),
            'rotation' => 0,
            'counters' => [],
            'zone' => $zone,
            'isCommander' => false,
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function commanderInstance(string $key, string $playerId, int $index, int $seat): array
    {
        return [
            ...$this->cardInstance($key, $playerId, 'command', 200 + $index, position: null),
            'instanceId' => sprintf('%s-command-commander-%d', $key, $index),
            'scryfallId' => sprintf('perf-%s-commander-%d', $key, $index),
            'name' => sprintf('Commander %d Seat %d', $index, $seat),
            'typeLine' => 'Legendary Creature - Performance',
            'colorIdentity' => $this->colorIdentityForPlayer($seat),
            'isCommander' => true,
        ];
    }

    /**
     * @param array<string,User> $usersByKey
     *
     * @return list<array<string,mixed>>
     */
    private function chatLog(array $usersByKey): array
    {
        $messages = [];
        $orderedUsers = array_values($usersByKey);
        for ($index = 1; $index <= 20; $index++) {
            $author = $orderedUsers[($index - 1) % count($orderedUsers)];
            $messages[] = [
                'id' => sprintf('chat-%02d', $index),
                'userId' => $author->id(),
                'displayName' => $author->displayName(),
                'message' => sprintf('Baseline chat message %02d', $index),
                'createdAt' => sprintf('2026-01-01T00:%02d:00+00:00', min(59, $index)),
            ];
        }

        $messages[] = [
            'id' => 'chat-private-1',
            'userId' => $usersByKey['p1']->id(),
            'displayName' => $usersByKey['p1']->displayName(),
            'message' => 'Private baseline line',
            'targetPlayerId' => $usersByKey['p2']->id(),
            'createdAt' => '2026-01-01T00:30:00+00:00',
        ];

        return $messages;
    }

    /**
     * @param array<string,User> $usersByKey
     *
     * @return list<array<string,mixed>>
     */
    private function eventLog(array $usersByKey): array
    {
        $entries = [];
        $orderedUsers = array_values($usersByKey);
        for ($index = 1; $index <= 16; $index++) {
            $actor = $orderedUsers[($index - 1) % count($orderedUsers)];
            $entries[] = [
                'id' => sprintf('event-%02d', $index),
                'type' => 'card.moved',
                'message' => sprintf('Baseline event %02d', $index),
                'playerId' => $actor->id(),
                'createdAt' => sprintf('2026-01-01T00:%02d:30+00:00', min(59, $index)),
            ];
        }

        return $entries;
    }
}
