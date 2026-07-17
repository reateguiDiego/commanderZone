<?php

namespace App\Tests\Application;

use App\Application\Game\GameLogPrivacySanitizer;
use PHPUnit\Framework\TestCase;

final class GameLogPrivacySanitizerTest extends TestCase
{
	public function testFaceDownMoveRemovesIdentityRecursivelyAndKeepsSafeMetadata(): void
	{
		$privateId = 'private-hand-instance';
		$entry = [
			'id' => 'log-1', 'type' => 'card.moved', 'message' => 'Owner moved a card from hand to battlefield.',
			'i18nKey' => 'gameLog.card.moved', 'visibility' => 'public', 'cardInstanceId' => $privateId,
			'cardNames' => ['Secret Card'], 'cardZone' => 'battlefield',
			'params' => ['fromZone' => 'hand', 'toZone' => 'battlefield', 'count' => 1, 'faceDown' => true, 'cardInstanceId' => $privateId],
			'refs' => [
				'players' => ['owner' => ['id' => 'owner', 'displayName' => 'Owner']],
				'cards' => [$privateId => ['instanceId' => $privateId, 'visibility' => 'hidden', 'cardKey' => 'secret@print']],
			],
		];

		$sanitized = (new GameLogPrivacySanitizer())->sanitizePublicEntry($entry);
		$encoded = json_encode($sanitized, JSON_THROW_ON_ERROR);
		foreach ([$privateId, 'secret@print', 'Secret Card', 'cardInstanceId', 'instanceId', 'cardKey'] as $forbidden) {
			self::assertStringNotContainsString($forbidden, $encoded);
		}
		self::assertSame('hand', $sanitized['params']['fromZone']);
		self::assertSame('battlefield', $sanitized['params']['toZone']);
		self::assertSame(1, $sanitized['params']['count']);
		self::assertTrue($sanitized['params']['faceDown']);
		self::assertSame('Owner', $sanitized['refs']['players']['owner']['displayName']);
	}

	public function testExplicitPublicReferenceRemainsAvailable(): void
	{
		$entry = [
			'type' => 'card.moved', 'cardInstanceId' => 'public-card',
			'params' => ['cardInstanceId' => 'public-card'],
			'refs' => ['cards' => ['public-card' => ['instanceId' => 'public-card', 'visibility' => 'public', 'cardKey' => 'public@print']]],
		];

		self::assertSame($entry, (new GameLogPrivacySanitizer())->sanitizePublicEntry($entry));
	}

	public function testLegacyBarePrivateIdFailsClosed(): void
	{
		$sanitized = (new GameLogPrivacySanitizer())->sanitizePublicEntry([
			'type' => 'cards.moved', 'cardInstanceId' => 'legacy-private-id',
			'params' => ['fromZone' => 'library', 'toZone' => 'battlefield'],
		]);

		self::assertArrayNotHasKey('cardInstanceId', $sanitized);
		self::assertStringNotContainsString('legacy-private-id', json_encode($sanitized, JSON_THROW_ON_ERROR));
	}

	public function testPrivateLibraryBatchKeepsSemanticKeyWhileRemovingIdentityRecursively(): void
	{
		$privateId = 'private-library-instance';
		$sanitized = (new GameLogPrivacySanitizer())->sanitizePublicEntry([
			'type' => 'library.top.play_face_down',
			'i18nKey' => 'gameLog.library.playedTopFaceDown',
			'params' => ['count' => 2, 'destination' => 'battlefield', 'faceDown' => true, 'instanceIds' => [$privateId]],
			'refs' => ['cards' => [$privateId => ['instanceId' => $privateId, 'cardKey' => 'secret@print']]],
		]);

		self::assertSame('gameLog.library.playedTopFaceDown', $sanitized['i18nKey']);
		self::assertSame(2, $sanitized['params']['count']);
		self::assertTrue($sanitized['params']['faceDown']);
		self::assertStringNotContainsString($privateId, json_encode($sanitized, JSON_THROW_ON_ERROR));
		self::assertArrayNotHasKey('cards', $sanitized['refs'] ?? []);
	}

	public function testPrivateHandBatchKeepsAggregateSemanticKeyAndAudienceScope(): void
	{
		$sanitized = (new GameLogPrivacySanitizer())->sanitizePublicEntry([
			'type' => 'hand.cards.reveal',
			'i18nKey' => 'gameLog.hand.revealed',
			'params' => [
				'count' => 3,
				'audienceScope' => 'players',
				'orderedInstanceIds' => ['secret-a', 'secret-b', 'secret-c'],
			],
		]);

		self::assertSame('gameLog.hand.revealed', $sanitized['i18nKey']);
		self::assertSame(3, $sanitized['params']['count']);
		self::assertSame('players', $sanitized['params']['audienceScope']);
		self::assertStringNotContainsString('secret-', json_encode($sanitized, JSON_THROW_ON_ERROR));
	}

	public function testPersistedEventEnvelopeIsSafeAtPublicReadBoundary(): void
	{
		$privateId = 'persisted-private-hand-instance';
		$sanitized = (new GameLogPrivacySanitizer())->sanitizePublicEntry([
			'id' => 'event-1',
			'type' => 'hand.cards.reveal',
			'payload' => [
				'playerId' => 'owner',
				'orderedInstanceIds' => [$privateId],
				'effects' => [['instanceId' => $privateId, 'finalRevealedTo' => ['target']]],
			],
		]);

		$encoded = json_encode($sanitized, JSON_THROW_ON_ERROR);
		self::assertStringNotContainsString($privateId, $encoded);
		self::assertSame('hand.cards.reveal', $sanitized['type']);
	}
}
