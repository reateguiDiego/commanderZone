<?php

namespace App\Application\Game\WebSocket;

use App\Application\Game\Contract\V2\GameplayV2ContractFactory;
use App\Application\Game\Contract\V2\GameplayV2Flags;

final readonly class GameWebsocketMessageHandler
{
    private const WEBSOCKET_COMMANDS = [
        'life.changed',
        'commander.damage.changed',
        'counter.changed',
        'chat.message',
        'chat.reaction.toggled',
        'dice.rolled',
        'turn.changed',
        'card.position.changed',
        'card.dungeon_marker.changed',
        'cards.position.changed',
        'card.tapped',
        'card.moved',
        'cards.moved',
        'zone.changed',
        'zone.move_all',
        'zone.random_card.selected',
        'library.draw',
        'library.draw_many',
        'library.shuffle',
        'library.move_top',
        'library.reveal_top',
        'library.reveal',
        'library.view',
        'library.play_top_revealed',
        'library.reorder_top',
        'library.put_top',
        'library.put_bottom',
        'card.face_down.changed',
        'card.face.changed',
        'card.revealed',
        'card.counter.changed',
        'card.power_toughness.changed',
        'card.controller.changed',
        'battlefield.untap_all',
        'card.token.created',
        'card.token_copy.created',
        'stack.card_added',
        'stack.item_removed',
        'arrow.created',
        'arrow.removed',
        'attachment.created',
        'attachment.removed',
        'helper.created',
        'helper.updated',
        'helper.removed',
        'game.concede',
        'game.close',
        'disconnect.vote',
    ];

    public function __construct(
        private GameWebsocketCommandPatchService $commands,
        private ?GameWebsocketMulliganService $mulligans = null,
        private ?GameplayV2ContractFactory $contractsV2 = null,
        private ?GameplayV2Flags $flagsV2 = null,
    ) {
    }

    /**
     * @param array<string,mixed> $message
     *
     * @return array<string,mixed>|GameWebsocketCommandResult|null
     */
    public function handle(array $message, GameWebsocketPeer $peer): array|GameWebsocketCommandResult|null
    {
        $messageId = $this->optionalNonEmptyString($message['messageId'] ?? null);
        $gameId = $message['gameId'] ?? null;
        if ($gameId !== null && !is_string($gameId)) {
            return $this->error($peer, 'INVALID_MESSAGE', 'Message gameId must be a string.', $messageId);
        }
        if (is_string($gameId) && trim($gameId) !== '' && $gameId !== $peer->gameId) {
            return $this->error($peer, 'GAME_ID_MISMATCH', 'Message gameId does not match the connected game.', $messageId);
        }

        $kind = $message['kind'] ?? null;
        if ($kind === 'ping') {
            if ($messageId === null) {
                return $this->error($peer, 'INVALID_MESSAGE', 'Ping messageId is required.');
            }

            return [
                'kind' => 'pong',
                'gameId' => $peer->gameId,
                'messageId' => $messageId,
                'serverTime' => (new \DateTimeImmutable())->format(DATE_ATOM),
            ];
        }

        if (is_string($kind) && $this->mulligans instanceof GameWebsocketMulliganService && $this->mulligans->supports($kind)) {
            return $this->mulligans->handle($kind, $message, $peer, $messageId);
        }

        if ($kind === 'command') {
            if ($messageId === null) {
                return $this->error($peer, 'INVALID_COMMAND_MESSAGE', 'Command messageId is required.');
            }

            $command = $message['command'] ?? null;
            if (!is_array($command)) {
                return $this->error($peer, 'INVALID_COMMAND_MESSAGE', 'Command payload is required.', $messageId);
            }

            $clientActionId = $this->optionalNonEmptyString($command['clientActionId'] ?? null);
            if ($clientActionId === null) {
                return $this->error($peer, 'INVALID_COMMAND_MESSAGE', 'Command clientActionId is required.', $messageId);
            }

            $baseVersion = $command['baseVersion'] ?? null;
            if (!is_int($baseVersion) || $baseVersion < 1) {
                return $this->error($peer, 'INVALID_COMMAND_MESSAGE', 'Command baseVersion must be an integer greater than or equal to 1.', $messageId);
            }

            $type = $this->optionalNonEmptyString($command['type'] ?? null);
            if ($type === null) {
                return $this->error($peer, 'INVALID_COMMAND_MESSAGE', 'Command type is required.', $messageId);
            }

            if (!in_array($type, self::WEBSOCKET_COMMANDS, true)) {
                return [
                    'kind' => 'command_ack',
                    'gameId' => $peer->gameId,
                    'messageId' => $messageId,
                    'clientActionId' => $clientActionId,
                    'status' => 'rejected',
                    'version' => $baseVersion,
                    'error' => [
                        'code' => 'COMMAND_NOT_SUPPORTED_OVER_WEBSOCKET',
                        'message' => 'This game command is not migrated to WebSocket yet.',
                        'retryable' => false,
                    ],
                ];
            }

            $payload = $command['payload'] ?? [];
            if (!is_array($payload)) {
                return $this->error($peer, 'INVALID_COMMAND_MESSAGE', 'Command payload must be an object.', $messageId);
            }

            return $this->commands->apply(
                $peer->gameId,
                $peer->userId,
                $type,
                $payload,
                $clientActionId,
                $baseVersion,
                $messageId,
                ticketPlayerId: $peer->effectivePlayerId(),
                ticketPermissions: $peer->permissions,
            );
        }

        if ($kind === 'command.v2') {
            if (!($this->flagsV2?->commandEnabled() ?? false) || !$this->contractsV2 instanceof GameplayV2ContractFactory) {
                return $this->error($peer, 'UNSUPPORTED_PROTOCOL_VERSION', 'Gameplay V2 commands are not enabled.', $messageId);
            }
            if ($messageId === null) {
                return $this->error($peer, 'INVALID_COMMAND_MESSAGE', 'Command messageId is required.');
            }

            try {
                $command = $this->contractsV2->commandFromWebsocketMessage($message);
            } catch (\InvalidArgumentException $exception) {
                return $this->error($peer, 'INVALID_COMMAND_MESSAGE', $exception->getMessage(), $messageId);
            }

            if ($command->gameId !== $peer->gameId) {
                return $this->error($peer, 'GAME_ID_MISMATCH', 'Message gameId does not match the connected game.', $messageId);
            }

            if (!in_array($command->type, self::WEBSOCKET_COMMANDS, true)) {
                return [
                    'kind' => 'command_ack',
                    'gameId' => $peer->gameId,
                    'messageId' => $messageId,
                    'clientActionId' => $command->clientActionId,
                    'status' => 'rejected',
                    'version' => $command->baseVersion,
                    'error' => [
                        'code' => 'COMMAND_NOT_SUPPORTED_OVER_WEBSOCKET',
                        'message' => 'This game command is not migrated to WebSocket yet.',
                        'retryable' => false,
                    ],
                ];
            }

            return $this->commands->apply(
                $peer->gameId,
                $peer->userId,
                $command->type,
                $command->payload,
                $command->clientActionId,
                $command->baseVersion,
                $messageId,
                'v2',
                ticketPlayerId: $peer->effectivePlayerId(),
                ticketPermissions: $peer->permissions,
            );
        }

        return $this->error($peer, 'UNKNOWN_MESSAGE_KIND', 'Unknown WebSocket gameplay message kind.', $messageId);
    }

    private function optionalNonEmptyString(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }

        $value = trim($value);

        return $value !== '' ? $value : null;
    }

    /**
     * @return array<string,mixed>
     */
    private function error(GameWebsocketPeer $peer, string $code, string $message, ?string $messageId = null): array
    {
        $reply = [
            'kind' => 'error',
            'gameId' => $peer->gameId,
            'error' => [
                'code' => $code,
                'message' => $message,
                'retryable' => false,
            ],
        ];
        if ($messageId !== null) {
            $reply['messageId'] = $messageId;
        }

        return $reply;
    }
}
