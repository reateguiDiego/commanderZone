<?php

namespace App\Application\Message;

use App\Domain\Message\UserMessage;
use App\Domain\User\User;

class RegistrationWelcomeMessageService
{
    private const SUBJECT = 'Welcome';
    private const BODY = <<<'MARKDOWN'
Welcome to CommanderZone!

The website is still under construction, so you may find rough edges while we finish the core experience.

We are working to ship CommanderZone 1.0 soon.
Thanks for joining early and helping us shape it.

If you want to tell us something or share suggestions, you can reach us through [Contact](/contact).

![Ms. Bumbleflower](https://api.scryfall.com/cards/blc/103?format=image&version=art_crop)

CommanderZone
MARKDOWN;

    public function createFor(User $user): UserMessage
    {
        return UserMessage::system($user, self::SUBJECT, self::BODY);
    }
}
