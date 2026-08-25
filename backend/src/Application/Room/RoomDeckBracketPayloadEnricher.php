<?php

namespace App\Application\Room;

use App\Application\Deck\DeckBracketLabelProvider;

final class RoomDeckBracketPayloadEnricher
{
    public function __construct(private readonly DeckBracketLabelProvider $bracketLabels)
    {
    }

    /**
     * Adds the compact, pre-game bracket label to every selected deck in a
     * waiting-room payload. The full deck analysis remains private.
     *
     * @param array<string,mixed> $room
     *
     * @return array<string,mixed>
     */
    public function enrich(array $room): array
    {
        $players = $room['players'] ?? null;
        if (!is_array($players)) {
            return $room;
        }

        $deckIds = [];
        foreach ($players as $player) {
            $deck = is_array($player) ? ($player['deck'] ?? null) : null;
            $deckId = is_array($deck) ? trim((string) ($deck['id'] ?? '')) : '';
            if ($deckId !== '') {
                $deckIds[] = $deckId;
            }
        }

        $bracketsByDeckId = $this->bracketLabels->labelsByDeckIds($deckIds, true);
        foreach ($players as $playerIndex => $player) {
            if (!is_array($player) || !is_array($player['deck'] ?? null)) {
                continue;
            }

            $deckId = trim((string) ($player['deck']['id'] ?? ''));
            $room['players'][$playerIndex]['deck']['bracket'] = $bracketsByDeckId[$deckId] ?? null;
        }

        return $room;
    }
}
