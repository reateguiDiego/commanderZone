<?php

namespace App\Application\Contact;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Mailer\MailerInterface;
use Symfony\Component\Mime\Address;
use Symfony\Component\Mime\Email;

class ContactMailer
{
    public function __construct(
        private readonly MailerInterface $mailer,
        #[Autowire('%env(MAILER_FROM_ADDRESS)%')]
        private readonly string $fromAddress,
        #[Autowire('%env(MAILER_FROM_NAME)%')]
        private readonly string $fromName,
        #[Autowire('%contact_inbox_address%')]
        private readonly string $inboxAddress,
    ) {
    }

    public function send(string $name, string $email, string $subject, string $message): void
    {
        $mail = (new Email())
            ->from(new Address($this->fromAddress, $this->fromName))
            ->to($this->inboxAddress)
            ->replyTo(new Address($email, $name))
            ->subject(sprintf('CommanderZone contact - %s', $subject))
            ->text(implode("\n", [
                sprintf('Name: %s', $name),
                sprintf('Email: %s', $email),
                sprintf('Subject: %s', $subject),
                '',
                'Message:',
                $message,
            ]));

        $this->mailer->send($mail);
    }
}
