<?php

namespace App\Application\Message;

use App\Domain\User\User;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Mailer\MailerInterface;
use Symfony\Component\Mime\Address;
use Symfony\Component\Mime\Email;
use Symfony\Component\Mime\Part\DataPart;

class AdminMessageMailer
{
    public function __construct(
        private readonly MailerInterface $mailer,
        #[Autowire('%env(MAILER_FROM_ADDRESS)%')]
        private readonly string $fromAddress,
        #[Autowire('%env(MAILER_FROM_NAME)%')]
        private readonly string $fromName,
        private readonly AdminMessageEmailBodyRenderer $emailBodyRenderer,
    ) {
    }

    public function send(User $recipient, string $subject, string $body): void
    {
        $renderedBody = $this->emailBodyRenderer->render($subject, $body);
        $message = (new Email())
            ->from(new Address($this->fromAddress, $this->fromName))
            ->to(new Address($recipient->email(), $recipient->displayName()))
            ->subject($subject)
            ->text($body)
            ->html($renderedBody->html);

        foreach ($renderedBody->inlineImages as $image) {
            $message->addPart(
                (new DataPart($image->content, $image->filename, $image->contentType))
                    ->asInline()
                    ->setContentId($image->contentId),
            );
        }

        $this->mailer->send($message);
    }
}
