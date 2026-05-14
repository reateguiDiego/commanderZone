<?php

namespace App\Tests\Domain;

use App\Domain\Auth\AuthRequestThrottle;
use App\Domain\Auth\EmailVerificationToken;
use App\Domain\Auth\LoginAttempt;
use App\Domain\Auth\PasswordResetToken;
use App\Domain\Card\Card;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\Game\Game;
use App\Domain\Game\GameEvent;
use App\Domain\Room\Room;
use App\Domain\Room\RoomPlayer;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class UpdatedAtBehaviorTest extends TestCase
{
    public function testCardDeckCardAndRoomPlayerTouchUpdatedAt(): void
    {
        $card = new Card('00000000-0000-0000-0000-0000000000c1');
        $card->updateFromScryfall([
            'name' => 'Touch Card',
            'type_line' => 'Artifact',
            'legalities' => ['commander' => 'legal'],
        ]);
        $cardUpdatedBefore = $this->updatedAtOf($card);
        usleep(2_000);
        $card->updateFromScryfall([
            'name' => 'Touch Card Prime',
            'type_line' => 'Artifact',
            'legalities' => ['commander' => 'legal'],
        ]);
        $this->assertUpdatedAtChanged($cardUpdatedBefore, $this->updatedAtOf($card));

        $owner = new User('updated-owner@example.test', 'Updated Owner');
        $deck = new Deck($owner, 'Updated Deck');
        $deckCard = new DeckCard($deck, $card, 1, DeckCard::SECTION_MAIN);
        $deckCardUpdatedBefore = $this->updatedAtOf($deckCard);
        usleep(2_000);
        $deckCard->changeQuantity(2);
        $this->assertUpdatedAtChanged($deckCardUpdatedBefore, $this->updatedAtOf($deckCard));

        $room = new Room($owner);
        $roomPlayer = new RoomPlayer($room, $owner, $deck);
        $roomPlayerUpdatedBefore = $this->updatedAtOf($roomPlayer);
        usleep(2_000);
        $roomPlayer->rollTurnOrder(15);
        $this->assertUpdatedAtChanged($roomPlayerUpdatedBefore, $this->updatedAtOf($roomPlayer));
    }

    public function testUserRoomAndGameExposeAndUpdateTimestamps(): void
    {
        $user = new User('timestamp-user@example.test', 'Timestamp User');
        $userUpdatedBefore = $this->updatedAtOf($user);
        usleep(2_000);
        $user->rename('Timestamp User Renamed');
        $userPayloadAfter = $user->toArray();
        self::assertArrayHasKey('createdAt', $userPayloadAfter);
        self::assertArrayHasKey('updatedAt', $userPayloadAfter);
        $this->assertUpdatedAtChanged($userUpdatedBefore, $this->updatedAtOf($user));

        $room = new Room($user);
        $roomUpdatedBefore = $this->updatedAtOf($room);
        usleep(2_000);
        $room->setName('Room Renamed');
        $roomPayloadAfter = $room->toArray();
        self::assertArrayHasKey('createdAt', $roomPayloadAfter);
        self::assertArrayHasKey('updatedAt', $roomPayloadAfter);
        $this->assertUpdatedAtChanged($roomUpdatedBefore, $this->updatedAtOf($room));

        $game = new Game($room, ['version' => 1]);
        $gameUpdatedBefore = $this->updatedAtOf($game);
        usleep(2_000);
        $game->replaceSnapshot(['version' => 2]);
        $gamePayloadAfter = $game->toArray();
        self::assertArrayHasKey('createdAt', $gamePayloadAfter);
        self::assertArrayHasKey('updatedAt', $gamePayloadAfter);
        $this->assertUpdatedAtChanged($gameUpdatedBefore, $this->updatedAtOf($game));
    }

    public function testAuthEntitiesTouchUpdatedAtOnMutations(): void
    {
        $user = new User('auth-updated@example.test', 'Auth Updated');

        $verificationToken = new EmailVerificationToken(
            $user,
            str_repeat('a', 64),
            $user->email(),
            EmailVerificationToken::PURPOSE_REGISTER,
            new \DateTimeImmutable('+1 hour'),
        );
        $verificationUpdatedBefore = $this->updatedAtOf($verificationToken);
        usleep(2_000);
        $verificationToken->markUsed();
        $this->assertUpdatedAtChanged($verificationUpdatedBefore, $this->updatedAtOf($verificationToken));

        $resetToken = new PasswordResetToken(
            $user,
            str_repeat('b', 64),
            new \DateTimeImmutable('+1 hour'),
        );
        $resetUpdatedBefore = $this->updatedAtOf($resetToken);
        usleep(2_000);
        $resetToken->markUsed();
        $this->assertUpdatedAtChanged($resetUpdatedBefore, $this->updatedAtOf($resetToken));

        $loginAttempt = new LoginAttempt('email', $user->email());
        $attemptUpdatedBefore = $this->updatedAtOf($loginAttempt);
        usleep(2_000);
        $loginAttempt->registerFailure(new \DateTimeImmutable());
        $this->assertUpdatedAtChanged($attemptUpdatedBefore, $this->updatedAtOf($loginAttempt));

        $throttle = new AuthRequestThrottle('password-reset', $user->email(), new \DateTimeImmutable());
        $throttleUpdatedBefore = $this->updatedAtOf($throttle);
        usleep(2_000);
        $throttle->consume(new \DateTimeImmutable(), 300);
        $this->assertUpdatedAtChanged($throttleUpdatedBefore, $this->updatedAtOf($throttle));
    }

    public function testGameEventUpdatedAtRemainsEqualToCreatedAt(): void
    {
        $owner = new User('event-owner@example.test', 'Event Owner');
        $room = new Room($owner);
        $game = new Game($room, ['version' => 1]);
        $event = new GameEvent($game, 'chat.message', ['message' => 'hello'], $owner, 'event-1');

        $createdAt = $this->dateTimeProperty($event, 'createdAt');
        $updatedAt = $this->dateTimeProperty($event, 'updatedAt');
        self::assertSame($createdAt->format(DATE_ATOM), $updatedAt->format(DATE_ATOM));
    }

    private function updatedAtOf(object $entity): \DateTimeImmutable
    {
        return $this->dateTimeProperty($entity, 'updatedAt');
    }

    private function dateTimeProperty(object $entity, string $property): \DateTimeImmutable
    {
        $reflection = new \ReflectionClass($entity);
        $prop = $reflection->getProperty($property);
        $prop->setAccessible(true);
        $value = $prop->getValue($entity);
        self::assertInstanceOf(\DateTimeImmutable::class, $value);

        return $value;
    }

    private function assertUpdatedAtChanged(\DateTimeImmutable $before, \DateTimeImmutable $after): void
    {
        self::assertGreaterThan(
            (float) $before->format('U.u'),
            (float) $after->format('U.u'),
        );
    }
}
