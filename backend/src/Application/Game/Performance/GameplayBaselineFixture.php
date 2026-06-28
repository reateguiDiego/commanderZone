<?php

namespace App\Application\Game\Performance;

use App\Domain\Game\Game;
use App\Domain\User\User;

final readonly class GameplayBaselineFixture
{
    /**
     * @param array<string,User>    $usersByKey
     * @param array<string,string>  $playerIdsByKey
     * @param array<string,list<string>> $battlefieldInstanceIdsByKey
     * @param array<string,list<string>> $libraryTopInstanceIdsByKey
     */
    public function __construct(
        private Game $game,
        private array $usersByKey,
        private array $playerIdsByKey,
        private array $battlefieldInstanceIdsByKey,
        private array $libraryTopInstanceIdsByKey,
    ) {
    }

    public function game(): Game
    {
        return $this->game;
    }

    public function user(string $key): User
    {
        return $this->usersByKey[$key];
    }

    public function playerId(string $key): string
    {
        return $this->playerIdsByKey[$key];
    }

    /**
     * @return list<string>
     */
    public function battlefieldInstanceIds(string $key, int $limit = 20): array
    {
        return array_slice($this->battlefieldInstanceIdsByKey[$key] ?? [], 0, max(0, $limit));
    }

    /**
     * @return list<string>
     */
    public function libraryTopInstanceIds(string $key, int $limit = 10): array
    {
        return array_slice($this->libraryTopInstanceIdsByKey[$key] ?? [], 0, max(0, $limit));
    }
}
