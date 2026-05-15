<?php

namespace App\Application\Auth;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Mailer\MailerInterface;
use Symfony\Component\Mime\Address;
use Symfony\Component\Mime\Email;

class AuthMailer
{
    public function __construct(
        private readonly MailerInterface $mailer,
        #[Autowire('%env(MAILER_FROM_ADDRESS)%')]
        private readonly string $fromAddress,
        #[Autowire('%env(MAILER_FROM_NAME)%')]
        private readonly string $fromName,
        #[Autowire('%env(AUTH_PUBLIC_APP_URL)%')]
        private readonly string $publicAppUrl,
    ) {
    }

    public function sendEmailVerification(string $recipientEmail, string $token): void
    {
        $verificationUrl = sprintf('%s/email-verification?token=%s', $this->basePublicUrl(), urlencode($token));

        $message = (new Email())
            ->from(new Address($this->fromAddress, $this->fromName))
            ->to($recipientEmail)
            ->subject('CommanderZone - Verify your email')
            ->text(
                implode("\n", [
                    'Welcome to CommanderZone.',
                    '',
                    'Please verify your email to secure your account.',
                    sprintf('Verification link: %s', $verificationUrl),
                ])
            );

        $this->mailer->send($message);
    }

    public function sendPasswordReset(string $recipientEmail, string $token): void
    {
        $resetUrl = sprintf('%s/auth/password-reset?token=%s', $this->basePublicUrl(), urlencode($token));

        $message = (new Email())
            ->from(new Address($this->fromAddress, $this->fromName))
            ->to($recipientEmail)
            ->subject('CommanderZone - Password reset request')
            ->text(
                implode("\n", [
                    'We received a password reset request for your CommanderZone account.',
                    '',
                    sprintf('Password reset link: %s', $resetUrl),
                    'If you did not request this, you can ignore this email.',
                ])
            );

        $this->mailer->send($message);
    }

    private function basePublicUrl(): string
    {
        return rtrim(trim($this->publicAppUrl), '/');
    }
}
