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
    }

    public function testCommunityDeckDetailReturnsOnlyPublicValidDecks(): void
    {
        $token = $this->registerAndLogin('community-detail@example.test', 'Community Detail');
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
        self::assertArrayHasKey('sections', $response['deck']);
        self::assertSame('Community Detail', $response['deck']['owner']['displayName']);

        $this->jsonRequest('GET', '/community/decks/'.$privateDeckId);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('GET', '/community/decks/'.$invalidDeckId);
        self::assertResponseStatusCodeSame(404);

        $this->jsonRequest('GET', '/community/decks/00000000-0000-0000-0000-000000000000');
        self::assertResponseStatusCodeSame(404);
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
}
