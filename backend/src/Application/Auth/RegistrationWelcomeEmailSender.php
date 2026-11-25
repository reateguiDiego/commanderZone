<?php

namespace App\Application\Auth;

use App\Application\Message\RegistrationWelcomeMessageService;
use App\Domain\User\User;

class RegistrationWelcomeEmailSender
{
    public function __construct(
        private readonly RegistrationWelcomeMessageService $registrationWelcomeMessageService,
        private readonly SecurityAuditLogger $securityAuditLogger,
    ) {
    }

    public function sendFailOpen(User $user, ?string $clientIp): void
    {
        try {
            $this->registrationWelcomeMessageService->sendEmailTo($user);
            $this->securityAuditLogger->log('auth.mail.registration_welcome.sent', $user->email(), $user->id(), $clientIp);
        } catch (\Throwable $exception) {
            $this->securityAuditLogger->log('auth.mail.registration_welcome.failed', $user->email(), $user->id(), $clientIp, [
                'reason' => 'mailer_transport_error',
                'exception' => $exception::class,
                'message' => $exception->getMessage(),
            ]);
        }
    }
}
