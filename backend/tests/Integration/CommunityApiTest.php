<?php

namespace App\Tests\Integration;

class CommunityApiTest extends ApiTestCase
{
    public function testCommunityHomeReturnsOnlyPublicValidDecks(): void
    {
        $token = $this->registerAndLogin('community-home@example.test', 'Community Home');
        $eligibleCommander = $this->seedCard('50000000-0000-0000-0000-000000000001', 'Home Commander', [
            'type_line' => 'Legendary Creature - Angel',
            'image_uris' => [
                'art_crop' => 'https://cards.scryfall.io/art_crop/front/home-commander.jpg',
                'normal' => 'https://cards.scryfall.io/normal/front/home-commander.jpg',
            ],
        ]);
        $secondCommander = $this->seedCard('50000000-0000-0000-0000-000000000002', 'Second Home Commander', [
            'type_line' => 'Legendary Creature - Wizard',
        ]);
        $thirdCommander = $this->seedCard('50000000-0000-0000-0000-000000000003', 'Third Home Commander', [
            'type_line' => 'Creature - Shapeshifter',
            'oracle_text' => 'This card can be your commander.',
        ]);
        $island = $this->seedCard('50000000-0000-0000-0000-000000000004', 'Home Island', [
            'type_line' => 'Basic Land - Island',
        ]);

        $publicValidDeckId = $this->createCommunityDeck($token, 'Visible Deck', 'public', true, $eligibleCommander->scryfallId(), $island->scryfallId());
        $this->createCommunityDeck($token, 'Private Deck', 'private', true, $secondCommander->scryfallId(), $island->scryfallId());
        $this->createCommunityDeck($token, 'Invalid Deck', 'public', false, $thirdCommander->scryfallId(), $island->scryfallId());

        $this->jsonRequest('GET', '/community');
        self::assertResponseIsSuccessful();

        $response = $this->jsonResponse();
        self::assertCount(1, $response['decks']);
        self::assertSame($publicValidDeckId, $response['decks'][0]['id']);
        self::assertSame('https://cards.scryfall.io/art_crop/front/home-commander.jpg', $response['decks'][0]['cropImage']);
        self::assertCount(3, $response['commanders']);
        self::assertCount(3, $response['cards']);
    }

    public function testCommunityDecksReturnsOnlyPublicValidDecks(): void
    {
        $token = $this->registerAndLogin('community-decks@example.test', 'Community Decks');
        $searchCommander = $this->seedCard('51000000-0000-0000-0000-000000000001', 'Search Commander', [
            'type_line' => 'Legendary Creature - Elf',
            'color_identity' => ['G'],
        ]);
        $otherCommander = $this->seedCard('51000000-0000-0000-0000-000000000002', 'Other Commander', [
            'type_line' => 'Legendary Creature - Dragon',
            'color_identity' => ['R'],
        ]);
        $island = $this->seedCard('51000000-0000-0000-0000-000000000003', 'Decks Island', [
            'type_line' => 'Basic Land - Island',
        ]);

        $matchingDeckId = $this->createCommunityDeck($token, 'Searchable Deck', 'public', true, $searchCommander->scryfallId(), $island->scryfallId());
        $this->createCommunityDeck($token, 'Private Search Deck', 'private', true, $searchCommander->scryfallId(), $island->scryfallId());
        $this->createCommunityDeck($token, 'Invalid Search Deck', 'public', false, $searchCommander->scryfallId(), $island->scryfallId());
        $this->createCommunityDeck($token, 'Other Deck', 'public', true, $otherCommander->scryfallId(), $island->scryfallId());

        $this->jsonRequest('GET', '/community/decks?q=Searchable&commander=Search%20Commander&format=commander&colors=G');
        self::assertResponseIsSuccessful();

        $response = $this->jsonResponse();
        self::assertCount(1, $response['decks']);
        self::assertSame($matchingDeckId, $response['decks'][0]['id']);
        self::assertSame(['G'], $response['decks'][0]['colorIdentity']);
        self::assertSame(1, $response['page']);
        self::assertSame(20, $response['limit']);
        self::assertSame(1, $response['total']);
        self::assertSame(1, $response['totalPages']);
        self::assertFalse($response['hasMore']);
    }

    public function testCommunityHomeReturnsTopDecksBySocialRanking(): void
    {
        $token = $this->registerAndLogin('community-home-ranking@example.test', 'Home Ranking');
        $mainCard = $this->seedCard('50a00000-0000-0000-0000-000000000001', 'Ranking Island', [
            'type_line' => 'Basic Land - Island',
        ]);
        $commander = $this->seedCard('50a00000-0000-0000-0000-000000000002', 'Ranking Commander', [
            'type_line' => 'Legendary Creature - Human',
        ]);
        $alphaTieCommander = $this->seedCard('50a00000-0000-0000-0000-000000000003', 'Alpha Tie Commander', [
            'type_line' => 'Legendary Creature - Human',
        ]);
        $betaTieCommander = $this->seedCard('50a00000-0000-0000-0000-000000000004', 'Beta Tie Commander', [
            'type_line' => 'Legendary Creature - Human',
        ]);

        $topByLikes = $this->createCommunityDeck($token, 'M Deck', 'public', true, $commander->scryfallId(), $mainCard->scryfallId());
        $topByTotal = $this->createCommunityDeck($token, 'A Deck', 'public', true, $commander->scryfallId(), $mainCard->scryfallId());
        $nameFirst = $this->createCommunityDeck($token, 'Aardvark Deck', 'public', true, $commander->scryfallId(), $mainCard->scryfallId());
        $sameNameAlphaCommander = $this->createCommunityDeck($token, 'Same Deck', 'public', true, $alphaTieCommander->scryfallId(), $mainCard->scryfallId());
        $sameNameBetaCommander = $this->createCommunityDeck($token, 'Same Deck', 'public', true, $betaTieCommander->scryfallId(), $mainCard->scryfallId());
        $nameLast = $this->createCommunityDeck($token, 'Zulu Deck', 'public', true, $commander->scryfallId(), $mainCard->scryfallId());

        $this->setDeckSocialCounters($topByLikes, 3, 1);
        $this->setDeckSocialCounters($topByTotal, 2, 2);
        $this->setDeckSocialCounters($nameFirst, 1, 1);
        $this->setDeckSocialCounters($sameNameAlphaCommander, 1, 1);
        $this->setDeckSocialCounters($sameNameBetaCommander, 1, 1);
        $this->setDeckSocialCounters($nameLast, 1, 1);

        $this->jsonRequest('GET', '/community');
        self::assertResponseIsSuccessful();

        self::assertSame(
            [$topByLikes, $topByTotal, $nameFirst, $sameNameAlphaCommander, $sameNameBetaCommander, $nameLast],
            array_column($this->jsonResponse()['decks'], 'id'),
        );
    }

    public function testCommunityDecksUsesSocialRankingWithFilters(): void
    {
        $token = $this->registerAndLogin('community-decks-ranking@example.test', 'Decks Ranking');
        $commander = $this->seedCard('50b00000-0000-0000-0000-000000000001', 'Filtered Ranking Commander', [
            'type_line' => 'Legendary Creature - Elf',
            'color_identity' => ['G'],
        ]);
        $otherCommander = $this->seedCard('50b00000-0000-0000-0000-000000000002', 'Other Ranking Commander', [
            'type_line' => 'Legendary Creature - Dragon',
            'color_identity' => ['R'],
        ]);
        $mainCard = $this->seedCard('50b00000-0000-0000-0000-000000000003', 'Filtered Ranking Island', [
            'type_line' => 'Basic Land - Island',
        ]);

        $middleByTotal = $this->createCommunityDeck($token, 'Ranking B', 'public', true, $commander->scryfallId(), $mainCard->scryfallId());
        $topByTotalAndLikes = $this->createCommunityDeck($token, 'Ranking A', 'public', true, $commander->scryfallId(), $mainCard->scryfallId());
        $lastByName = $this->createCommunityDeck($token, 'Ranking Z', 'public', true, $commander->scryfallId(), $mainCard->scryfallId());
        $firstByName = $this->createCommunityDeck($token, 'Ranking C', 'public', true, $commander->scryfallId(), $mainCard->scryfallId());
        $otherDeck = $this->createCommunityDeck($token, 'Ranking Other', 'public', true, $otherCommander->scryfallId(), $mainCard->scryfallId());

        $this->setDeckSocialCounters($middleByTotal, 2, 3);
        $this->setDeckSocialCounters($topByTotalAndLikes, 4, 1);
        $this->setDeckSocialCounters($firstByName, 1, 1);
        $this->setDeckSocialCounters($lastByName, 1, 1);
        $this->setDeckSocialCounters($otherDeck, 99, 99);

        $this->jsonRequest('GET', '/community/decks?commander=Filtered%20Ranking%20Commander&format=commander&colors=G');
        self::assertResponseIsSuccessful();

        $response = $this->jsonResponse();
        self::assertSame(
            [$topByTotalAndLikes, $middleByTotal, $firstByName, $lastByName],
            array_column($response['decks'], 'id'),
        );
        self::assertSame(4, $response['total']);
    }

    public function testCommunityUserReturnsFilteredPublicDeckPage(): void
    {
        $token = $this->registerAndLogin('community-user@example.test', 'Community User');
        $otherToken = $this->registerAndLogin('community-user-other@example.test', 'Community Other');
        $this->jsonRequest('PATCH', '/me/display-name-style', [
            'presetId' => 'obsidian-crown',
            'textColor' => '#ffeeaa',
        ], $token);
        self::assertResponseIsSuccessful();
        $userCommander = $this->seedCard('5b000000-0000-0000-0000-000000000001', 'User Commander', [
            'type_line' => 'Legendary Creature - Elf',
            'color_identity' => ['G'],
        ]);
        $otherCommander = $this->seedCard('5b000000-0000-0000-0000-000000000002', 'Other User Commander', [
            'type_line' => 'Legendary Creature - Dragon',
            'color_identity' => ['R'],
        ]);
        $island = $this->seedCard('5b000000-0000-0000-0000-000000000003', 'User Island', [
            'type_line' => 'Basic Land - Island',
        ]);

        $matchingDeckId = $this->createCommunityDeck($token, 'Searchable User Deck', 'public', true, $userCommander->scryfallId(), $island->scryfallId());
        $this->createCommunityDeck($token, 'Other User Deck', 'public', true, $otherCommander->scryfallId(), $island->scryfallId());
        $this->createCommunityDeck($token, 'Private User Deck', 'private', true, $userCommander->scryfallId(), $island->scryfallId());
        $this->createCommunityDeck($token, 'Invalid User Deck', 'public', false, $userCommander->scryfallId(), $island->scryfallId());
        $this->createCommunityDeck($otherToken, 'Searchable User Deck', 'public', true, $userCommander->scryfallId(), $island->scryfallId());
        $username = $this->publicUsernameForEmail('community-user@example.test');

        $this->jsonRequest('GET', '/community/users/'.rawurlencode($username).'?q=Searchable&commander=User%20Commander&format=commander&colors=G');
        self::assertResponseIsSuccessful();

        $response = $this->jsonResponse();
        self::assertNotEmpty($response['user']['id']);
        self::assertSame($username, $response['user']['username']);
        self::assertSame('/community/users/'.rawurlencode($username), $response['user']['canonicalPath']);
        self::assertSame('Community User', $response['user']['displayName']);
        self::assertSame([
            'type' => 'preset',
            'presetId' => 'obsidian-crown',
            'textColor' => '#ffeeaa',
        ], $response['user']['displayNameStyle']);
        self::assertCount(1, $response['decks']);
        self::assertSame($matchingDeckId, $response['decks'][0]['id']);
        self::assertSame(1, $response['page']);
        self::assertSame(20, $response['limit']);
        self::assertSame(1, $response['total']);
        self::assertSame(1, $response['totalPages']);
        self::assertFalse($response['hasMore']);

        $this->jsonRequest('GET', '/community/users/'.rawurlencode($username).'?q=Nope');
        self::assertResponseIsSuccessful();
        $emptyResponse = $this->jsonResponse();
        self::assertSame($username, $emptyResponse['user']['username']);
        self::assertSame([], $emptyResponse['decks']);
        self::assertSame(0, $emptyResponse['total']);
    }

    public function testCommunityUserRejectsMissingUsersAndRemovedProfileRoute(): void
    {
        $token = $this->registerAndLogin('community-user-route@example.test', 'Community User Route');
        $this->registerAndLogin('community-user-empty@example.test', 'Community User Empty');
        $commander = $this->seedCard('5c000000-0000-0000-0000-000000000001', 'Route Commander', [
            'type_line' => 'Legendary Creature - Human',
        ]);
        $island = $this->seedCard('5c000000-0000-0000-0000-000000000002', 'Route Island', [
            'type_line' => 'Basic Land - Island',
        ]);
        $this->createCommunityDeck($token, 'Route Deck', 'public', true, $commander->scryfallId(), $island->scryfallId());
        $username = $this->publicUsernameForEmail('community-user-route@example.test');
        $emptyUsername = $this->publicUsernameForEmail('community-user-empty@example.test');

        $this->jsonRequest('GET', '/community/users/'.rawurlencode($emptyUsername));
        self::assertResponseIsSuccessful();
        $emptyResponse = $this->jsonResponse();
        self::assertSame($emptyUsername, $emptyResponse['user']['username']);
        self::assertSame('/community/users/'.rawurlencode($emptyUsername), $emptyResponse['user']['canonicalPath']);
        self::assertSame([], $emptyResponse['decks']);
        self::assertSame(0, $emptyResponse['total']);
        self::assertSame(1, $emptyResponse['totalPages']);

        $this->jsonRequest('GET', '/community/users/missing-user');
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('GET', '/community/profiles/'.rawurlencode($username));
        self::assertResponseStatusCodeSame(404);
    }

    public function testCommunityDeckDetailReturnsOnlyPublicValidDecks(): void
    {
        $token = $this->registerAndLogin('community-detail@example.test', 'Community Detail');
        $this->jsonRequest('PATCH', '/me/display-name-style', [
            'presetId' => 'obsidian-crown',
            'textColor' => '#ffeeaa',
        ], $token);
        self::assertResponseIsSuccessful();

        $commander = $this->seedCard('52000000-0000-0000-0000-000000000001', 'Detail Commander', [
            'type_line' => 'Legendary Creature - Human',
        ]);
        $island = $this->seedCard('52000000-0000-0000-0000-000000000002', 'Detail Island', [
            'type_line' => 'Basic Land - Island',
        ]);

        $publicValidDeckId = $this->createCommunityDeck($token, 'Public Detail Deck', 'public', true, $commander->scryfallId(), $island->scryfallId());
        $privateDeckId = $this->createCommunityDeck($token, 'Private Detail Deck', 'private', true, $commander->scryfallId(), $island->scryfallId());
        $invalidDeckId = $this->createCommunityDeck($token, 'Invalid Detail Deck', 'public', false, $commander->scryfallId(), $island->scryfallId());

        $this->jsonRequest('GET', '/community/decks/'.$publicValidDeckId);
        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame($publicValidDeckId, $response['deck']['id']);
        self::assertSame('public', $response['deck']['visibility']);
        self::assertSame($this->currentUserId($token), $response['deck']['creatorUserId']);
        self::assertSame(0, $response['deck']['likes']);
        self::assertSame(0, $response['deck']['copies']);
        self::assertFalse($response['deck']['likedByViewer']);
        self::assertArrayHasKey('sections', $response['deck']);
        self::assertSame('Community Detail', $response['deck']['owner']['displayName']);
        self::assertSame([
            'type' => 'preset',
            'presetId' => 'obsidian-crown',
            'textColor' => '#ffeeaa',
        ], $response['deck']['owner']['displayNameStyle']);

        $this->jsonRequest('GET', '/community/decks/'.$privateDeckId);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('GET', '/community/decks/'.$invalidDeckId);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('GET', '/community/decks/00000000-0000-0000-0000-000000000000');
        self::assertResponseStatusCodeSame(404);
    }

    public function testCommunityDeckLikeTogglesOncePerUser(): void
    {
        $ownerToken = $this->registerAndLogin('community-like-owner@example.test', 'Like Owner');
        $firstToken = $this->registerAndLogin('community-like-first@example.test', 'Like First');
        $secondToken = $this->registerAndLogin('community-like-second@example.test', 'Like Second');
        $commander = $this->seedCard('52100000-0000-0000-0000-000000000001', 'Like Commander', [
            'type_line' => 'Legendary Creature - Human',
        ]);
        $island = $this->seedCard('52100000-0000-0000-0000-000000000002', 'Like Island', [
            'type_line' => 'Basic Land - Island',
        ]);
        $deckId = $this->createCommunityDeck($ownerToken, 'Liked Deck', 'public', true, $commander->scryfallId(), $island->scryfallId());

        $this->jsonRequest('POST', '/community/decks/'.$deckId.'/like');
        self::assertResponseStatusCodeSame(401);

        $this->jsonRequest('POST', '/community/decks/'.$deckId.'/like', token: $ownerToken);
        self::assertResponseStatusCodeSame(409);
        self::assertSame(0, (int) $this->entityManager->getConnection()->fetchOne(
            'SELECT likes FROM deck WHERE id = :deckId',
            ['deckId' => $deckId],
        ));

        $this->jsonRequest('POST', '/community/decks/'.$deckId.'/like', token: $firstToken);
        self::assertResponseIsSuccessful();
        self::assertSame(1, $this->jsonResponse()['deck']['likes']);
        self::assertTrue($this->jsonResponse()['deck']['likedByViewer']);

        $this->jsonRequest('POST', '/community/decks/'.$deckId.'/like', token: $firstToken);
        self::assertResponseIsSuccessful();
        self::assertSame(0, $this->jsonResponse()['deck']['likes']);
        self::assertFalse($this->jsonResponse()['deck']['likedByViewer']);

        $this->jsonRequest('POST', '/community/decks/'.$deckId.'/like', token: $secondToken);
        self::assertResponseIsSuccessful();
        self::assertSame(1, $this->jsonResponse()['deck']['likes']);
        self::assertTrue($this->jsonResponse()['deck']['likedByViewer']);

        $this->jsonRequest('GET', '/community/decks/'.$deckId, token: $firstToken);
        self::assertResponseIsSuccessful();
        $detail = $this->jsonResponse()['deck'];
        self::assertSame(1, $detail['likes']);
        self::assertFalse($detail['likedByViewer']);
    }

    public function testCommunityDeckCopyCreatesPrivateDeckAndPreservesOriginalCreator(): void
    {
        $ownerToken = $this->registerAndLogin('community-copy-owner@example.test', 'Copy Owner');
        $copyToken = $this->registerAndLogin('community-copy-viewer@example.test', 'Copy Viewer');
        $ownerId = $this->currentUserId($ownerToken);
        $copyUserId = $this->currentUserId($copyToken);
        $commander = $this->seedCard('52200000-0000-0000-0000-000000000001', 'Copy Commander', [
            'type_line' => 'Legendary Creature - Human',
        ]);
        $island = $this->seedCard('52200000-0000-0000-0000-000000000002', 'Copy Island', [
            'type_line' => 'Basic Land - Island',
        ]);
        $sourceDeckId = $this->createCommunityDeck($ownerToken, 'Copied Deck', 'public', true, $commander->scryfallId(), $island->scryfallId());

        $this->jsonRequest('POST', '/community/decks/'.$sourceDeckId.'/copy');
        self::assertResponseStatusCodeSame(401);

        $this->jsonRequest('POST', '/community/decks/'.$sourceDeckId.'/copy', token: $ownerToken);
        self::assertResponseStatusCodeSame(409);
        self::assertSame(0, (int) $this->entityManager->getConnection()->fetchOne(
            'SELECT copies FROM deck WHERE id = :deckId',
            ['deckId' => $sourceDeckId],
        ));

        $this->jsonRequest('POST', '/community/decks/'.$sourceDeckId.'/copy', token: $copyToken);
        self::assertResponseStatusCodeSame(201);
        $response = $this->jsonResponse();
        $copiedDeck = $response['deck'];
        self::assertSame(1, $response['source']['copies']);
        self::assertSame($ownerId, $copiedDeck['creatorUserId']);
        self::assertSame(0, $copiedDeck['likes']);
        self::assertSame(0, $copiedDeck['copies']);
        self::assertTrue($copiedDeck['valid']);
        self::assertSame('private', $copiedDeck['visibility']);
        self::assertCount(2, $copiedDeck['cards']);

        $storedCopy = $this->entityManager->getConnection()->fetchAssociative(
            'SELECT owner_id, creator_user_id, visibility, is_valid FROM deck WHERE id = :deckId',
            ['deckId' => $copiedDeck['id']],
        );
        self::assertIsArray($storedCopy);
        self::assertSame($copyUserId, $storedCopy['owner_id']);
        self::assertSame($ownerId, $storedCopy['creator_user_id']);
        self::assertSame('private', $storedCopy['visibility']);
        self::assertTrue((bool) $storedCopy['is_valid']);
        self::assertSame(1, (int) $this->entityManager->getConnection()->fetchOne(
            'SELECT copies FROM deck WHERE id = :deckId',
            ['deckId' => $sourceDeckId],
        ));
    }

    public function testCommunityCardDiscoveryReturnsRelatedPublicDecks(): void
    {
        $token = $this->registerAndLogin('community-card-discovery@example.test', 'Card Discovery');
        $commander = $this->seedCard('57000000-0000-0000-0000-000000000001', 'Discovery Commander', [
            'type_line' => 'Legendary Creature - Human',
        ]);
        $mainCard = $this->seedCard('57000000-0000-0000-0000-000000000002', 'Discovery Main Card', [
            'type_line' => 'Basic Land - Island',
        ]);

        $deckId = $this->createCommunityDeck($token, 'Discovery Deck', 'public', true, $commander->scryfallId(), $mainCard->scryfallId());

        $this->jsonRequest('GET', '/community/cards/discovery-main-card-00000002');
        self::assertResponseIsSuccessful();

        $response = $this->jsonResponse();
        self::assertSame($mainCard->scryfallId(), $response['item']['scryfallId']);
        self::assertCount(1, $response['decks']);
        self::assertSame($deckId, $response['decks'][0]['id']);
        self::assertMatchesRegularExpression(
            '/^discovery-commander-discovery-deck-commander-[a-z0-9]{8}$/',
            (string) $response['decks'][0]['publicSlug'],
        );
        self::assertSame('/community/decks/'.$response['decks'][0]['publicSlug'].'/', $response['decks'][0]['canonicalPath']);
    }

    public function testCommunityIndexableUsesDeckUpdatesForCardAndCommanderLastmod(): void
    {
        $token = $this->registerAndLogin('community-indexable-lastmod@example.test', 'Indexable Lastmod');
        $commander = $this->seedCard('58000000-0000-0000-0000-000000000001', 'Stable Commander', [
            'type_line' => 'Legendary Creature - Human',
        ]);
        $mainCard = $this->seedCard('58000000-0000-0000-0000-000000000002', 'Stable Main Card', [
            'type_line' => 'Basic Land - Island',
        ]);

        $deckId = $this->createCommunityDeck($token, 'Stable Index Deck', 'public', true, $commander->scryfallId(), $mainCard->scryfallId());

        $this->jsonRequest('GET', '/community/indexable');
        self::assertResponseIsSuccessful();

        $response = $this->jsonResponse();
        $deckEntry = $this->singleIndexableEntry($response['decks'], static fn (array $entry): bool => ($entry['id'] ?? null) === $deckId);
        $commanderEntry = $this->singleIndexableEntry($response['commanders'], static fn (array $entry): bool => ($entry['slug'] ?? null) === 'stable-commander-00000001');
        $cardEntry = $this->singleIndexableEntry($response['cards'], static fn (array $entry): bool => ($entry['slug'] ?? null) === 'stable-main-card-00000002');
        $username = $this->publicUsernameForEmail('community-indexable-lastmod@example.test');
        $userEntry = $this->singleIndexableEntry($response['users'], static fn (array $entry): bool => ($entry['username'] ?? null) === $username);

        self::assertNotSame('', $deckEntry['updatedAt']);
        self::assertSame($deckEntry['updatedAt'], $commanderEntry['updatedAt']);
        self::assertSame($deckEntry['updatedAt'], $cardEntry['updatedAt']);
        self::assertSame('/community/users/'.rawurlencode($username), $userEntry['canonicalPath']);
        self::assertArrayNotHasKey('profiles', $response);
    }

    public function testCommunityIndexableOnlyIncludesPublicValidDecks(): void
    {
        $token = $this->registerAndLogin('community-indexable-validity@example.test', 'Indexable Validity');
        $commander = $this->seedCard('59000000-0000-0000-0000-000000000001', 'Validity Commander', [
            'type_line' => 'Legendary Creature - Human',
        ]);
        $mainCard = $this->seedCard('59000000-0000-0000-0000-000000000002', 'Validity Island', [
            'type_line' => 'Basic Land - Island',
        ]);
        $extraCard = $this->seedCard('59000000-0000-0000-0000-000000000003', 'Validity Rock', [
            'type_line' => 'Artifact',
        ]);

        $deckId = $this->createCommunityDeck($token, 'Validity Deck', 'public', false, $commander->scryfallId(), $mainCard->scryfallId());

        $this->jsonRequest('GET', '/community/indexable');
        self::assertResponseIsSuccessful();
        self::assertSame([], array_values(array_filter(
            $this->jsonResponse()['decks'],
            static fn (array $entry): bool => ($entry['id'] ?? null) === $deckId,
        )));

        $this->jsonRequest('POST', '/decks/'.$deckId.'/validate-commander', token: $token);
        self::assertResponseIsSuccessful();
        self::assertTrue($this->jsonResponse()['valid']);

        $this->jsonRequest('GET', '/community/indexable');
        self::assertResponseIsSuccessful();
        $this->singleIndexableEntry($this->jsonResponse()['decks'], static fn (array $entry): bool => ($entry['id'] ?? null) === $deckId);

        $this->jsonRequest('POST', '/decks/'.$deckId.'/cards', [
            'scryfallId' => $extraCard->scryfallId(),
            'quantity' => 1,
            'section' => 'main',
        ], $token);
        self::assertResponseIsSuccessful();
        self::assertFalse($this->jsonResponse()['deck']['valid']);

        $this->jsonRequest('GET', '/community/indexable');
        self::assertResponseIsSuccessful();
        self::assertSame([], array_values(array_filter(
            $this->jsonResponse()['decks'],
            static fn (array $entry): bool => ($entry['id'] ?? null) === $deckId,
        )));
    }

    public function testCommunityIndexableDoesNotBackfillDiscoveryFields(): void
    {
        $token = $this->registerAndLogin('community-indexable-readonly@example.test', 'Indexable Readonly');
        $commander = $this->seedCard('5a000000-0000-0000-0000-000000000001', 'Readonly Commander', [
            'type_line' => 'Legendary Creature - Human',
        ]);
        $mainCard = $this->seedCard('5a000000-0000-0000-0000-000000000002', 'Readonly Island', [
            'type_line' => 'Basic Land - Island',
        ]);

        $deckId = $this->createCommunityDeck($token, 'Readonly Deck', 'public', true, $commander->scryfallId(), $mainCard->scryfallId());
        $ownerId = (string) $this->entityManager->getConnection()->fetchOne(
            'SELECT owner_id FROM deck WHERE id = :deckId',
            ['deckId' => $deckId],
        );
        $this->entityManager->getConnection()->executeStatement(
            'UPDATE deck SET public_slug = NULL WHERE id = :deckId',
            ['deckId' => $deckId],
        );
        $this->entityManager->getConnection()->executeStatement(
            'UPDATE app_user SET public_handle = NULL WHERE id = :ownerId',
            ['ownerId' => $ownerId],
        );

        $this->jsonRequest('GET', '/community/indexable');
        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame([], array_values(array_filter(
            $response['decks'],
            static fn (array $entry): bool => ($entry['id'] ?? null) === $deckId,
        )));
        self::assertNull($this->entityManager->getConnection()->fetchOne(
            'SELECT public_slug FROM deck WHERE id = :deckId',
            ['deckId' => $deckId],
        ));
        self::assertNull($this->entityManager->getConnection()->fetchOne(
            'SELECT public_handle FROM app_user WHERE id = :ownerId',
            ['ownerId' => $ownerId],
        ));
    }

    public function testCommunityTopCommandersReturnsOnlyCommanderCandidates(): void
    {
        $legendaryCandidate = $this->seedCard('53000000-0000-0000-0000-000000000001', 'Legendary Candidate', [
            'type_line' => 'Legendary Creature - Angel',
        ]);
        $oracleCandidate = $this->seedCard('53000000-0000-0000-0000-000000000002', 'Oracle Candidate', [
            'type_line' => 'Creature - Shapeshifter',
            'oracle_text' => 'This card can be your commander.',
        ]);
        $this->seedCard('53000000-0000-0000-0000-000000000003', 'Not A Commander', [
            'type_line' => 'Artifact',
        ]);

        $this->jsonRequest('GET', '/community/top-commanders');
        self::assertResponseIsSuccessful();

        $response = $this->jsonResponse();
        self::assertTrue($response['isPreview']);
        self::assertSame(2, $response['total']);
        self::assertSame(
            "Pr\u{00F3}ximamente: estad\u{00ED}sticas basadas en partidas reales de CommanderZone.",
            $response['message'],
        );
        $names = array_values(array_column($response['items'], 'name'));
        sort($names);
        self::assertSame(['Legendary Candidate', 'Oracle Candidate'], $names);

        $itemsByScryfallId = [];
        foreach ($response['items'] as $item) {
            $itemsByScryfallId[$item['scryfallId']] = $item;
        }

        self::assertSame($legendaryCandidate->id(), $itemsByScryfallId[$legendaryCandidate->scryfallId()]['id']);
        self::assertSame('Legendary Creature - Angel', $itemsByScryfallId[$legendaryCandidate->scryfallId()]['cardType']);
        self::assertSame('creature', $itemsByScryfallId[$legendaryCandidate->scryfallId()]['cardTypeIcon']);
        self::assertIsArray($itemsByScryfallId[$legendaryCandidate->scryfallId()]['imageUris']);
        self::assertIsArray($itemsByScryfallId[$legendaryCandidate->scryfallId()]['cardFaces']);
        self::assertGreaterThanOrEqual(500, $itemsByScryfallId[$legendaryCandidate->scryfallId()]['timesPlayed']);
        self::assertLessThanOrEqual(3000, $itemsByScryfallId[$legendaryCandidate->scryfallId()]['timesPlayed']);
        self::assertSame($oracleCandidate->id(), $itemsByScryfallId[$oracleCandidate->scryfallId()]['id']);

        $playedCounts = array_values(array_column($response['items'], 'timesPlayed'));
        $sortedPlayedCounts = $playedCounts;
        rsort($sortedPlayedCounts);
        self::assertSame($sortedPlayedCounts, $playedCounts);
    }

    public function testCommunityTopCardsReturnsOnlyCommanderLegalCards(): void
    {
        $legalCard = $this->seedCard('54000000-0000-0000-0000-000000000001', 'Legal Community Card', [
            'type_line' => 'Artifact',
        ]);
        $this->seedCard('54000000-0000-0000-0000-000000000002', 'Banned Community Card', [
            'type_line' => 'Artifact',
            'legalities' => ['commander' => 'banned'],
        ]);

        $this->jsonRequest('GET', '/community/top-cards');
        self::assertResponseIsSuccessful();

        $response = $this->jsonResponse();
        self::assertTrue($response['isPreview']);
        self::assertSame(1, $response['total']);
        self::assertSame(['Legal Community Card'], array_values(array_column($response['items'], 'name')));
        self::assertSame([$legalCard->scryfallId()], array_values(array_column($response['items'], 'scryfallId')));
        self::assertSame([$legalCard->id()], array_values(array_column($response['items'], 'id')));
        self::assertSame(['Artifact'], array_values(array_column($response['items'], 'cardType')));
        self::assertSame(['artifact'], array_values(array_column($response['items'], 'cardTypeIcon')));
        self::assertGreaterThanOrEqual(500, $response['items'][0]['timesPlayed']);
        self::assertLessThanOrEqual(3000, $response['items'][0]['timesPlayed']);
    }

    public function testCommunityTopCardsLocalizesRequestedLanguageWithEnglishFallback(): void
    {
        $localizedCard = $this->seedCard('55000000-0000-0000-0000-000000000001', 'Localized Preview Card', [
            'type_line' => 'Artifact',
            'set' => 'tst',
            'collector_number' => '7',
            'lang' => 'en',
        ]);
        $this->seedCard('55000000-0000-0000-0000-000000000002', 'Localized Preview Card', [
            'type_line' => 'Artefacto',
            'printed_name' => 'Carta Localizada',
            'set' => 'tst',
            'collector_number' => '7',
            'lang' => 'es',
        ]);
        $fallbackEnglishCard = $this->seedCard('55000000-0000-0000-0000-000000000003', 'Fallback Preview Card', [
            'type_line' => 'Instant',
            'set' => 'tst',
            'collector_number' => '8',
            'lang' => 'en',
        ]);

        $this->jsonRequest('GET', '/community/top-cards?lang=es');
        self::assertResponseIsSuccessful();

        $response = $this->jsonResponse();
        $itemsByScryfallId = [];
        foreach ($response['items'] as $item) {
            $itemsByScryfallId[$item['scryfallId']] = $item;
        }

        self::assertSame('Carta Localizada', $itemsByScryfallId[$localizedCard->scryfallId()]['name']);
        self::assertSame('Artefacto', $itemsByScryfallId[$localizedCard->scryfallId()]['cardType']);
        self::assertSame('artifact', $itemsByScryfallId[$localizedCard->scryfallId()]['cardTypeIcon']);
        self::assertSame('Fallback Preview Card', $itemsByScryfallId[$fallbackEnglishCard->scryfallId()]['name']);
        self::assertSame('Instant', $itemsByScryfallId[$fallbackEnglishCard->scryfallId()]['cardType']);
        self::assertSame('instant', $itemsByScryfallId[$fallbackEnglishCard->scryfallId()]['cardTypeIcon']);
    }

    public function testCommunityTopPreviewFiltersByTypeAndColor(): void
    {
        $this->seedCard('56000000-0000-0000-0000-000000000001', 'Blue Instant', [
            'type_line' => 'Instant',
            'colors' => ['U'],
        ]);
        $this->seedCard('56000000-0000-0000-0000-000000000002', 'Red Sorcery', [
            'type_line' => 'Sorcery',
            'colors' => ['R'],
        ]);
        $this->seedCard('56000000-0000-0000-0000-000000000003', 'Colorless Rock', [
            'type_line' => 'Artifact',
            'colors' => [],
        ]);

        $this->jsonRequest('GET', '/community/top-cards?type=instant&colors=U');
        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame(1, $response['total']);
        self::assertSame(['Blue Instant'], array_values(array_column($response['items'], 'name')));

        $this->jsonRequest('GET', '/community/top-cards?type=artifact&colors=C');
        self::assertResponseIsSuccessful();
        $response = $this->jsonResponse();
        self::assertSame(1, $response['total']);
        self::assertSame(['Colorless Rock'], array_values(array_column($response['items'], 'name')));
    }

    private function createCommunityDeck(
        string $token,
        string $name,
        string $visibility,
        bool $validate,
        string $commanderScryfallId,
        string $mainCardScryfallId,
    ): string {
        $this->jsonRequest('POST', '/decks/quick-build', [
            'name' => $name,
            'visibility' => $visibility,
            'cards' => [
                ['scryfallId' => $commanderScryfallId, 'quantity' => 1, 'section' => 'commander'],
                ['scryfallId' => $mainCardScryfallId, 'quantity' => 99, 'section' => 'main'],
            ],
        ], $token);
        self::assertResponseStatusCodeSame(201);
        $deckId = (string) $this->jsonResponse()['deck']['id'];

        if ($validate) {
            $this->jsonRequest('POST', '/decks/'.$deckId.'/validate-commander', token: $token);
            self::assertResponseIsSuccessful();
            self::assertTrue($this->jsonResponse()['valid']);
        }

        return $deckId;
    }

    /**
     * @param list<array<string,mixed>> $entries
     * @param callable(array<string,mixed>): bool $predicate
     *
     * @return array<string,mixed>
     */
    private function singleIndexableEntry(array $entries, callable $predicate): array
    {
        $matches = array_values(array_filter($entries, $predicate));
        self::assertCount(1, $matches);

        return $matches[0];
    }

    private function publicUsernameForEmail(string $email): string
    {
        $displayName = (string) $this->entityManager->getConnection()->fetchOne(
            'SELECT display_name FROM app_user WHERE email = :email',
            ['email' => $email],
        );

        return preg_replace('/\s+/', '-', trim($displayName)) ?? '';
    }

    private function setDeckSocialCounters(string $deckId, int $likes, int $copies): void
    {
        $this->entityManager->getConnection()->executeStatement(
            'UPDATE deck SET likes = :likes, copies = :copies WHERE id = :deckId',
            [
                'deckId' => $deckId,
                'likes' => $likes,
                'copies' => $copies,
            ],
        );
    }
}
