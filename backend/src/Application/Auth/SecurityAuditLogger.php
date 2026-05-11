<?php

namespace App\Application\Auth;

use Psr\Log\LoggerInterface;

class SecurityAuditLogger
{
    public function __construct(
        private readonly LoggerInterface $logger,
        private readonly AuthTokenService $tokenService,
    ) {
    }

    /**
     * @param array<string,mixed> $extra
     */
    public function log(string $event, ?string $email, ?string $userId, ?string $ip, array $extra = []): void
    {
        $context = [
            'event' => $event,
            'emailHash' => $email !== null && trim($email) !== '' ? $this->tokenService->hashEmail($email) : null,
            'userId' => $userId,
            'ip' => $ip,
            ...$extra,
        ];

        $this->logger->info('security.audit', $context);
    }
}
