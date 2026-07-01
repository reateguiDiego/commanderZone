<?php

namespace App\Application\Game\WebSocket;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

final readonly class GameWebsocketTicketManager
{
    private const TTL_SECONDS = 60;

    public function __construct(
        #[Autowire('%game_runtime_ticket_secret%')]
        private string $secret,
    ) {
    }

    /**
     * @param list<string> $permissions
     */
    public function issue(
        string $gameId,
        string $userId,
        ?\DateTimeImmutable $now = null,
        ?string $playerId = null,
        string $role = 'player',
        array $permissions = ['view', 'command'],
    ): GameWebsocketTicket
    {
        $issuedAt = $now ?? new \DateTimeImmutable();
        $expiresAt = $issuedAt->modify(sprintf('+%d seconds', self::TTL_SECONDS));
        $playerId = $this->nonEmptyOrDefault($playerId, $userId);
        $role = $this->nonEmptyOrDefault($role, 'player');
        $permissions = $this->normalizePermissions($permissions);
        $payload = [
            'gameId' => $gameId,
            'userId' => $userId,
            'playerId' => $playerId,
            'role' => $role,
            'permissions' => $permissions,
            'roles' => [$role],
            'viewerKind' => $role,
            'protocol' => 'v2',
            'iat' => $issuedAt->getTimestamp(),
            'exp' => $expiresAt->getTimestamp(),
        ];
        $encodedPayload = $this->base64UrlEncode(json_encode($payload, JSON_THROW_ON_ERROR));
        $signature = $this->sign($encodedPayload);

        return new GameWebsocketTicket(
            ticket: $encodedPayload.'.'.$signature,
            gameId: $gameId,
            userId: $userId,
            playerId: $playerId,
            role: $role,
            permissions: $permissions,
            issuedAt: $issuedAt,
            expiresAt: $expiresAt,
        );
    }

    public function validate(string $ticket, string $expectedGameId, ?\DateTimeImmutable $now = null): GameWebsocketTicket
    {
        $parts = explode('.', $ticket, 2);
        if (count($parts) !== 2 || $parts[0] === '' || $parts[1] === '') {
            throw new \InvalidArgumentException('Invalid websocket ticket.');
        }

        [$encodedPayload, $signature] = $parts;
        if (!hash_equals($this->sign($encodedPayload), $signature)) {
            throw new \InvalidArgumentException('Invalid websocket ticket signature.');
        }

        try {
            $payload = json_decode($this->base64UrlDecode($encodedPayload), true, flags: JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new \InvalidArgumentException('Invalid websocket ticket payload.');
        }

        if (!is_array($payload)) {
            throw new \InvalidArgumentException('Invalid websocket ticket payload.');
        }

        $gameId = $this->payloadString($payload, 'gameId');
        $userId = $this->payloadString($payload, 'userId');
        $playerId = $this->payloadOptionalString($payload, 'playerId') ?? $userId;
        $role = $this->payloadOptionalString($payload, 'role')
            ?? (is_array($payload['roles'] ?? null) && is_string(($payload['roles'][0] ?? null)) ? (string) $payload['roles'][0] : 'player');
        $permissions = $this->payloadPermissions($payload);
        $issuedAt = $this->payloadInt($payload, 'iat');
        $expiresAt = $this->payloadInt($payload, 'exp');
        if ($gameId !== $expectedGameId) {
            throw new \InvalidArgumentException('Websocket ticket game mismatch.');
        }

        $currentTimestamp = ($now ?? new \DateTimeImmutable())->getTimestamp();
        if ($expiresAt <= $currentTimestamp) {
            throw new \InvalidArgumentException('Websocket ticket expired.');
        }

        return new GameWebsocketTicket(
            ticket: $ticket,
            gameId: $gameId,
            userId: $userId,
            playerId: $playerId,
            role: $role,
            permissions: $permissions,
            issuedAt: (new \DateTimeImmutable())->setTimestamp($issuedAt),
            expiresAt: (new \DateTimeImmutable())->setTimestamp($expiresAt),
        );
    }

    private function sign(string $encodedPayload): string
    {
        return $this->base64UrlEncode(hash_hmac('sha256', $encodedPayload, $this->secret, true));
    }

    private function payloadString(array $payload, string $key): string
    {
        $value = $payload[$key] ?? null;
        if (!is_string($value) || trim($value) === '') {
            throw new \InvalidArgumentException('Invalid websocket ticket payload.');
        }

        return $value;
    }

    private function payloadOptionalString(array $payload, string $key): ?string
    {
        $value = $payload[$key] ?? null;
        if (!is_string($value) || trim($value) === '') {
            return null;
        }

        return trim($value);
    }

    private function payloadInt(array $payload, string $key): int
    {
        $value = $payload[$key] ?? null;
        if (!is_int($value)) {
            throw new \InvalidArgumentException('Invalid websocket ticket payload.');
        }

        return $value;
    }

    private function nonEmptyOrDefault(?string $value, string $default): string
    {
        $normalized = trim((string) $value);

        return $normalized !== '' ? $normalized : $default;
    }

    /**
     * @param list<string> $permissions
     *
     * @return list<string>
     */
    private function normalizePermissions(array $permissions): array
    {
        $normalized = array_values(array_unique(array_filter(array_map(
            static fn (mixed $permission): string => is_string($permission) ? trim($permission) : '',
            $permissions,
        ), static fn (string $permission): bool => $permission !== '')));

        return $normalized !== [] ? $normalized : ['view'];
    }

    /**
     * @param array<string,mixed> $payload
     *
     * @return list<string>
     */
    private function payloadPermissions(array $payload): array
    {
        $permissions = $payload['permissions'] ?? null;
        if (!is_array($permissions)) {
            return ['view'];
        }

        return $this->normalizePermissions($permissions);
    }

    private function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function base64UrlDecode(string $value): string
    {
        $decoded = base64_decode(strtr($value, '-_', '+/'), true);
        if (!is_string($decoded)) {
            throw new \InvalidArgumentException('Invalid websocket ticket encoding.');
        }

        return $decoded;
    }
}
