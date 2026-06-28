<?php

namespace App\Application\Game\Compact;

final readonly class CompactGameState
{
    /**
     * @param array<string,mixed> $players
     * @param array<string,array<string,mixed>> $instances
     * @param array<string,array{library:list<string>,hand:list<string>,battlefield:list<string>,graveyard:list<string>,exile:list<string>,command:list<string>}> $zones
     * @param array<string,array{playerId:string,zone:string,index:int}> $loc
     * @param array<string,mixed> $visibility
     * @param array{
     *   attachments:array<string,array<string,mixed>>,
     *   arrows:array<string,array<string,mixed>>,
     *   helpers:array<string,array<string,mixed>>,
     *   indexes?:array<string,array<string,list<string>>>
     * } $relations
     * @param list<array<string,mixed>> $stack
     * @param array<string,array<string,mixed>> $cardCatalog
     * @param array<string,mixed> $extra
     */
    public function __construct(
        public ?string $gameId,
        public int $version,
        public string $status,
        public array $players,
        public array $turn,
        public array $instances,
        public array $zones,
        public array $loc,
        public array $visibility,
        public array $relations,
        public array $stack,
        public array $cardCatalog,
        public array $extra = [],
    ) {
    }

    /**
     * @return array<string,mixed>
     */
    public function toArray(): array
    {
        return [
            'runtimeFormat' => CompactGameCardStateMapper::SNAPSHOT_FORMAT,
            'gameId' => $this->gameId,
            'version' => $this->version,
            'status' => $this->status,
            'players' => $this->players,
            'turn' => $this->turn,
            'instances' => $this->instances,
            'zones' => $this->zones,
            'loc' => $this->loc,
            'visibility' => $this->visibility,
            'relations' => $this->relations,
            'stack' => $this->stack,
            'cardCatalog' => $this->cardCatalog,
            ...$this->extra,
        ];
    }
}
