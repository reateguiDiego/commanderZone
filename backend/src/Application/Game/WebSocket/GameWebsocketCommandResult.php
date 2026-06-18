<?php

namespace App\Application\Game\WebSocket;

final readonly class GameWebsocketCommandResult
{
    /**
     * @param array<string,array<string,mixed>|list<array<string,mixed>>> $messagesByUserId
     * @param array<string,mixed>|list<array<string,mixed>>               $fallbackMessage
     */
    private function __construct(
        private array $messagesByUserId,
        private array $fallbackMessage,
        private ?array $debugProfile = null,
    ) {
    }

    /**
     * @param array<string,array<string,mixed>> $messagesByUserId
     * @param array<string,mixed>               $fallbackMessage
     */
    public static function forViewers(array $messagesByUserId, array $fallbackMessage, ?array $debugProfile = null): self
    {
        return new self($messagesByUserId, $fallbackMessage, $debugProfile);
    }

    /**
     * @param array<string,list<array<string,mixed>>> $messagesByUserId
     * @param list<array<string,mixed>>               $fallbackMessages
     */
    public static function forViewerMessageLists(array $messagesByUserId, array $fallbackMessages, ?array $debugProfile = null): self
    {
        return new self($messagesByUserId, $fallbackMessages, $debugProfile);
    }

    /**
     * @return array<string,mixed>
     */
    public function messageForPeer(GameWebsocketPeer $peer): array
    {
        return $this->messageForUserId($peer->userId);
    }

    /**
     * @return array<string,mixed>
     */
    public function messageForUserId(string $userId): array
    {
        return $this->messagesForUserId($userId)[0];
    }

    /**
     * @return list<array<string,mixed>>
     */
    public function messagesForPeer(GameWebsocketPeer $peer): array
    {
        return $this->messagesForUserId($peer->userId);
    }

    /**
     * @return list<array<string,mixed>>
     */
    public function messagesForUserId(string $userId): array
    {
        return $this->messageList($this->messagesByUserId[$userId] ?? $this->fallbackMessage);
    }

    /**
     * @return array<string,array<string,mixed>>
     */
    public function messagesByUserId(): array
    {
        $messagesByUserId = [];
        foreach ($this->messagesByUserId as $userId => $messages) {
            $messagesByUserId[$userId] = $this->messageList($messages)[0];
        }

        return $messagesByUserId;
    }

    /**
     * @return array<string,list<array<string,mixed>>>
     */
    public function messageListsByUserId(): array
    {
        $messagesByUserId = [];
        foreach ($this->messagesByUserId as $userId => $messages) {
            $messagesByUserId[$userId] = $this->messageList($messages);
        }

        return $messagesByUserId;
    }

    /**
     * @return array<string,float>|null
     */
    public function debugProfile(): ?array
    {
        return $this->debugProfile;
    }

    /**
     * @param array<string,mixed>|list<array<string,mixed>> $messages
     *
     * @return list<array<string,mixed>>
     */
    private function messageList(array $messages): array
    {
        if (array_is_list($messages) && $messages !== []) {
            $allMessages = true;
            foreach ($messages as $message) {
                if (!is_array($message) || !is_string($message['kind'] ?? null)) {
                    $allMessages = false;
                    break;
                }
            }
            if ($allMessages) {
                return $messages;
            }
        }

        return [$messages];
    }
}
