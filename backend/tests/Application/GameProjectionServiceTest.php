<?php

namespace App\Tests\Application;

use App\Application\Card\CardLocalizationService;
use App\Application\Game\GameCommandHandler;
use App\Application\Game\GameCardRulingsLookup;
use App\Application\Game\GameProjectionService;
use App\Domain\User\User;
use PHPUnit\Framework\TestCase;

class GameProjectionServiceTest extends TestCase
{
    public function testOpponentHandProjectionCentersRevealedCardsWithoutLeakingOriginalPosition(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $viewer = new User('viewer@example.test', 'Viewer');
        $snapshot = $this->snapshot($owner->id(), $viewer->id());

        $projected = (new GameProjectionService(new GameCommandHandler()))->projectSnapshot($snapshot, $viewer);
        $hand = $projected['players'][$owner->id()]['zones']['hand'];

        self::assertCount(5, $hand);
        self::assertSame('Hidden card', $hand[0]['name']);
        self::assertTrue($hand[0]['hidden']);
        self::assertSame('Hidden card', $hand[1]['name']);
        self::assertTrue($hand[1]['hidden']);
        self::assertSame('Revealed Tutor', $hand[2]['name']);
        self::assertSame([$viewer->id()], $hand[2]['revealedTo']);
        self::assertArrayNotHasKey('hidden', $hand[2]);
        self::assertSame('Hidden card', $hand[3]['name']);
        self::assertTrue($hand[3]['hidden']);
        self::assertSame('Hidden card', $hand[4]['name']);
        self::assertTrue($hand[4]['hidden']);
    }

    public function testOpponentLibraryProjectionShowsOnlyTopRevealTargetTheRealCard(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $target = new User('target@example.test', 'Target');
        $other = new User('other@example.test', 'Other');
        $snapshot = $this->snapshot($owner->id(), $target->id());
        $snapshot['players'][$other->id()] = $this->player($other->id(), []);
        $snapshot['players'][$owner->id()]['zones']['library'] = [
            [
                ...$this->card('top-card', 'Revealed Top'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'library',
                'revealedTo' => [$target->id()],
            ],
            [
                ...$this->card('second-card', 'Private Second'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'library',
            ],
        ];
        $projection = new GameProjectionService(new GameCommandHandler());

        $targetLibrary = $projection->projectSnapshot($snapshot, $target)['players'][$owner->id()]['zones']['library'];
        $otherLibrary = $projection->projectSnapshot($snapshot, $other)['players'][$owner->id()]['zones']['library'];

        self::assertCount(1, $targetLibrary);
        self::assertSame('Revealed Top', $targetLibrary[0]['name']);
        self::assertArrayNotHasKey('hidden', $targetLibrary[0]);
        self::assertCount(1, $otherLibrary);
        self::assertSame('Hidden card', $otherLibrary[0]['name']);
        self::assertTrue($otherLibrary[0]['hidden']);
        self::assertTrue($otherLibrary[0]['faceDown']);
    }

    public function testOpponentLibraryProjectionShowsOnlyTopCardWhenPlayTopRevealedIsActive(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $viewer = new User('viewer@example.test', 'Viewer');
        $snapshot = $this->snapshot($owner->id(), $viewer->id());
        $snapshot['players'][$owner->id()]['playTopLibraryRevealed'] = true;
        $snapshot['players'][$owner->id()]['zones']['library'] = [
            [
                ...$this->card('top-card', 'Public Top'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'library',
            ],
            [
                ...$this->card('second-card', 'Private Second'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'library',
                'revealedTo' => ['all'],
            ],
        ];

        $library = (new GameProjectionService(new GameCommandHandler()))
            ->projectSnapshot($snapshot, $viewer)['players'][$owner->id()]['zones']['library'];

        self::assertCount(1, $library);
        self::assertSame('Public Top', $library[0]['name']);
        self::assertArrayNotHasKey('hidden', $library[0]);
    }

    public function testOpponentLibraryZoneProjectionShowsFullLibraryOnlyWhenCardsAreRevealedToViewer(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $viewer = new User('viewer@example.test', 'Viewer');
        $cards = [
            [
                ...$this->card('top-card', 'Public Top'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'library',
                'faceDown' => true,
                'revealedTo' => [$viewer->id()],
            ],
            [
                ...$this->card('second-card', 'Public Second'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'library',
                'faceDown' => true,
                'revealedTo' => [$viewer->id()],
            ],
        ];

        $library = (new GameProjectionService(new GameCommandHandler()))
            ->projectZone($cards, $owner->id(), 'library', $viewer);

        self::assertCount(2, $library);
        self::assertSame('Public Top', $library[0]['name']);
        self::assertSame('Public Second', $library[1]['name']);
        self::assertFalse($library[0]['faceDown']);
        self::assertFalse($library[1]['faceDown']);
    }

    public function testOpponentLibraryZoneProjectionDoesNotLeakFullRevealToOtherPlayers(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $target = new User('target@example.test', 'Target');
        $other = new User('other@example.test', 'Other');
        $cards = [
            [
                ...$this->card('top-card', 'Target Top'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'library',
                'revealedTo' => [$target->id()],
            ],
            [
                ...$this->card('second-card', 'Target Second'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'library',
                'revealedTo' => [$target->id()],
            ],
        ];

        $library = (new GameProjectionService(new GameCommandHandler()))
            ->projectZone($cards, $owner->id(), 'library', $other);

        self::assertCount(1, $library);
        self::assertSame('Hidden card', $library[0]['name']);
        self::assertTrue($library[0]['hidden']);
    }

    public function testProjectionUntapsLegacyCardsOutsideBattlefield(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $viewer = new User('viewer@example.test', 'Viewer');
        $snapshot = $this->snapshot($owner->id(), $viewer->id());
        $snapshot['players'][$owner->id()]['zones']['hand'] = [
            [
                ...$this->card('legacy-tapped-hand', 'Legacy Tapped Hand'),
                'tapped' => true,
                'rotation' => 90,
            ],
        ];

        $hand = (new GameProjectionService(new GameCommandHandler()))
            ->projectSnapshot($snapshot, $owner)['players'][$owner->id()]['zones']['hand'];

        self::assertFalse($hand[0]['tapped']);
        self::assertSame(0, $hand[0]['rotation']);
    }

    public function testProjectionLocalizesOnlyVisibleCardImagesPerViewerLanguageWithoutLeakingHiddenZones(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $spanishViewer = new User('spanish@example.test', 'Spanish');
        $frenchViewer = new User('french@example.test', 'French');
        $spanishViewer->updateCardLanguage('es');
        $frenchViewer->updateCardLanguage('fr');

        $snapshot = $this->snapshot($owner->id(), $spanishViewer->id());
        $snapshot['players'][$frenchViewer->id()] = $this->player($frenchViewer->id(), []);
        $snapshot['players'][$owner->id()]['zones']['battlefield'] = [[
            ...$this->card('public-card', 'Sol Ring'),
            'ownerId' => $owner->id(),
            'controllerId' => $owner->id(),
            'zone' => 'battlefield',
            'scryfallId' => 'sol-ring-print',
            'typeLine' => 'Artifact',
            'oracleText' => '{T}: Add {C}.',
            'revealedTo' => ['all'],
        ]];
        $snapshot['players'][$owner->id()]['zones']['hand'] = [[
            ...$this->card('hidden-hand', 'Private Spell'),
            'ownerId' => $owner->id(),
            'controllerId' => $owner->id(),
            'zone' => 'hand',
            'scryfallId' => 'private-print',
        ]];

        $localization = $this->getMockBuilder(CardLocalizationService::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['localizedImagePayloadLookupForScryfallIds'])
            ->getMock();
        $localization
            ->expects(self::exactly(2))
            ->method('localizedImagePayloadLookupForScryfallIds')
            ->willReturnCallback(static function (array $scryfallIds, array $languages): array {
                self::assertSame(['sol-ring-print'], $scryfallIds);
                $language = $languages[0] ?? null;
                if (!is_string($language)) {
                    return [];
                }

                return [
                    $language => [
                        'sol-ring-print' => [
                            'scryfallId' => 'sol-ring-print',
                            'name' => $language === 'es' ? 'Anillo solar' : ($language === 'fr' ? 'Anneau solaire' : 'Sol Ring'),
                            'typeLine' => $language === 'es' ? 'Artefacto' : ($language === 'fr' ? 'Artefact' : 'Artifact'),
                            'oracleText' => $language === 'es' ? '{T}: Agrega {C}.' : ($language === 'fr' ? '{T}: Ajoutez {C}.' : '{T}: Add {C}.'),
                            'imageUris' => ['normal' => sprintf('https://cards.example/sol-ring-%s.jpg', $language)],
                        ],
                    ],
                ];
            });

        $projection = new GameProjectionService(new GameCommandHandler(), $localization);

        $spanishProjection = $projection->projectSnapshot($snapshot, $spanishViewer);
        $frenchProjection = $projection->projectSnapshot($snapshot, $frenchViewer);

        self::assertSame('Sol Ring', $spanishProjection['players'][$owner->id()]['zones']['battlefield'][0]['name']);
        self::assertSame('Sol Ring', $frenchProjection['players'][$owner->id()]['zones']['battlefield'][0]['name']);
        self::assertSame('Artifact', $spanishProjection['players'][$owner->id()]['zones']['battlefield'][0]['typeLine'] ?? null);
        self::assertSame('Artifact', $frenchProjection['players'][$owner->id()]['zones']['battlefield'][0]['typeLine'] ?? null);
        self::assertSame('https://cards.example/sol-ring-es.jpg', $spanishProjection['players'][$owner->id()]['zones']['battlefield'][0]['imageUris']['normal']);
        self::assertSame('https://cards.example/sol-ring-fr.jpg', $frenchProjection['players'][$owner->id()]['zones']['battlefield'][0]['imageUris']['normal']);
        self::assertSame('Hidden card', $spanishProjection['players'][$owner->id()]['zones']['hand'][0]['name']);
        self::assertSame('Hidden card', $frenchProjection['players'][$owner->id()]['zones']['hand'][0]['name']);
        self::assertArrayNotHasKey('imageUris', $spanishProjection['players'][$owner->id()]['zones']['hand'][0]);
        self::assertArrayNotHasKey('imageUris', $frenchProjection['players'][$owner->id()]['zones']['hand'][0]);
    }

    public function testProjectionHydratesRulingsOnlyForCardsThatStayVisibleToTheViewer(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $viewer = new User('viewer@example.test', 'Viewer');
        $snapshot = $this->snapshot($owner->id(), $viewer->id());
        $snapshot['players'][$owner->id()]['zones']['battlefield'] = [[
            ...$this->card('public-card', 'Rules Lawyer'),
            'ownerId' => $owner->id(),
            'controllerId' => $owner->id(),
            'zone' => 'battlefield',
            'scryfallId' => 'rules-lawyer-print',
        ]];
        $snapshot['players'][$owner->id()]['zones']['hand'] = [[
            ...$this->card('hidden-card', 'Private Tutor'),
            'ownerId' => $owner->id(),
            'controllerId' => $owner->id(),
            'zone' => 'hand',
            'scryfallId' => 'private-print',
        ]];

        $rulingsLookup = $this->createMock(GameCardRulingsLookup::class);
        $rulingsLookup
            ->expects(self::once())
            ->method('hasRulingsByScryfallIds')
            ->with(['rules-lawyer-print'])
            ->willReturn(['rules-lawyer-print' => true]);

        $projection = (new GameProjectionService(new GameCommandHandler(), null, $rulingsLookup))
            ->projectSnapshot($snapshot, $viewer);

        self::assertTrue($projection['players'][$owner->id()]['zones']['battlefield'][0]['hasRulings']);
        self::assertSame('Hidden card', $projection['players'][$owner->id()]['zones']['hand'][0]['name']);
    }

    public function testProjectionCanUsePrecomputedLocalizationLookupForImagesWithoutMetadataHydration(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $spanishViewer = new User('spanish@example.test', 'Spanish');
        $spanishViewer->updateCardLanguage('es');

        $snapshot = $this->snapshot($owner->id(), $spanishViewer->id());
        $snapshot['players'][$owner->id()]['zones']['battlefield'] = [[
            ...$this->card('public-card', 'Sol Ring'),
            'ownerId' => $owner->id(),
            'controllerId' => $owner->id(),
            'zone' => 'battlefield',
            'scryfallId' => 'sol-ring-print',
            'typeLine' => 'Artifact',
            'revealedTo' => ['all'],
        ]];

        $lookup = [
            'es' => [
                'sol-ring-print' => [
                    'name' => 'Anillo solar',
                    'printedName' => 'Anillo solar',
                    'lang' => 'es',
                    'imageUris' => ['normal' => 'https://cards.example/sol-ring-es.jpg'],
                    'cardFaces' => [],
                    'typeLine' => 'Artefacto',
                    'manaCost' => '{1}',
                    'oracleText' => '{T}: Agrega {C}.',
                ],
            ],
        ];

        $projection = (new GameProjectionService(new GameCommandHandler()))->projectSnapshot($snapshot, $spanishViewer, true, $lookup);

        self::assertSame('Sol Ring', $projection['players'][$owner->id()]['zones']['battlefield'][0]['name']);
        self::assertArrayNotHasKey('lang', $projection['players'][$owner->id()]['zones']['battlefield'][0]);
        self::assertSame('Artifact', $projection['players'][$owner->id()]['zones']['battlefield'][0]['typeLine']);
        self::assertSame('https://cards.example/sol-ring-es.jpg', $projection['players'][$owner->id()]['zones']['battlefield'][0]['imageUris']['normal']);
    }

    public function testProjectionDoesNotFallbackToLocalizationServiceWhenPrecomputedLookupIsExplicitlyEmpty(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $viewer = new User('viewer@example.test', 'Viewer');
        $viewer->updateCardLanguage('es');
        $snapshot = $this->snapshot($owner->id(), $viewer->id());
        $snapshot['players'][$owner->id()]['zones']['battlefield'] = [[
            ...$this->card('public-card', 'Sol Ring'),
            'ownerId' => $owner->id(),
            'controllerId' => $owner->id(),
            'zone' => 'battlefield',
            'scryfallId' => 'sol-ring-print',
            'revealedTo' => ['all'],
        ]];

        $localization = $this->getMockBuilder(CardLocalizationService::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['localizedImagePayloadLookupForScryfallIds', 'localizeCardPayloadImagesOnly'])
            ->getMock();
        $localization->expects(self::never())->method('localizedImagePayloadLookupForScryfallIds');
        $localization->expects(self::never())->method('localizeCardPayloadImagesOnly');

        $projection = (new GameProjectionService(new GameCommandHandler(), $localization))
            ->projectSnapshot($snapshot, $viewer, true, []);

        self::assertSame(
            'https://cards.example/public-card.jpg',
            $projection['players'][$owner->id()]['zones']['battlefield'][0]['imageUris']['normal'],
        );
    }

    public function testProjectionFallsBackToLocalizationServiceWhenLookupIsNotProvided(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $viewer = new User('viewer@example.test', 'Viewer');
        $viewer->updateCardLanguage('es');
        $snapshot = $this->snapshot($owner->id(), $viewer->id());
        $snapshot['players'][$owner->id()]['zones']['battlefield'] = [[
            ...$this->card('public-card', 'Sol Ring'),
            'ownerId' => $owner->id(),
            'controllerId' => $owner->id(),
            'zone' => 'battlefield',
            'scryfallId' => 'sol-ring-print',
            'revealedTo' => ['all'],
        ]];

        $localization = $this->getMockBuilder(CardLocalizationService::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['localizedImagePayloadLookupForScryfallIds', 'localizeCardPayloadImagesOnly'])
            ->getMock();
        $localization
            ->expects(self::once())
            ->method('localizedImagePayloadLookupForScryfallIds')
            ->with(['sol-ring-print'], ['es'])
            ->willReturn([
                'es' => [
                    'sol-ring-print' => [
                        'imageUris' => ['normal' => 'https://cards.example/sol-ring-es.jpg'],
                        'cardFaces' => [],
                    ],
                ],
            ]);
        $localization->expects(self::never())->method('localizeCardPayloadImagesOnly');

        $projection = (new GameProjectionService(new GameCommandHandler(), $localization))
            ->projectSnapshot($snapshot, $viewer);

        self::assertSame(
            'https://cards.example/sol-ring-es.jpg',
            $projection['players'][$owner->id()]['zones']['battlefield'][0]['imageUris']['normal'],
        );
    }

    public function testProjectionHydratesPersistedRulingsMetadataForLegacySnapshots(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $viewer = new User('viewer@example.test', 'Viewer');
        $snapshot = $this->snapshot($owner->id(), $viewer->id());
        $snapshot['players'][$owner->id()]['zones']['battlefield'] = [[
            ...$this->card('public-card', 'Rules Lawyer'),
            'ownerId' => $owner->id(),
            'controllerId' => $owner->id(),
            'zone' => 'battlefield',
            'scryfallId' => 'rules-lawyer-print',
        ]];

        $rulingsLookup = $this->createMock(GameCardRulingsLookup::class);
        $rulingsLookup
            ->expects(self::once())
            ->method('hasRulingsByScryfallIds')
            ->with(['rules-lawyer-print'])
            ->willReturn(['rules-lawyer-print' => true]);

        $projection = (new GameProjectionService(new GameCommandHandler(), null, $rulingsLookup))
            ->projectSnapshot($snapshot, $viewer);

        self::assertTrue($projection['players'][$owner->id()]['zones']['battlefield'][0]['hasRulings']);
    }

    public function testProjectionLocalizesRevealedOpponentHandImagesWithoutChangingMetadata(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $viewer = new User('viewer@example.test', 'Viewer');
        $viewer->updateCardLanguage('es');
        $snapshot = $this->snapshot($owner->id(), $viewer->id());
        $snapshot['players'][$owner->id()]['zones']['hand'] = [[
            ...$this->card('revealed-hand', 'Private Tutor'),
            'ownerId' => $owner->id(),
            'controllerId' => $owner->id(),
            'zone' => 'hand',
            'scryfallId' => 'private-tutor-print',
            'typeLine' => 'Instant',
            'revealedTo' => [$viewer->id()],
        ]];

        $lookup = [
            'es' => [
                'private-tutor-print' => [
                    'name' => 'Tutor privado',
                    'imageUris' => ['normal' => 'https://cards.example/private-tutor-es.jpg'],
                    'typeLine' => 'Instantaneo',
                    'oracleText' => 'Busca una carta.',
                    'cardFaces' => [],
                ],
            ],
        ];

        $hand = (new GameProjectionService(new GameCommandHandler()))
            ->projectSnapshot($snapshot, $viewer, true, $lookup)['players'][$owner->id()]['zones']['hand'];

        self::assertCount(1, $hand);
        self::assertSame('Private Tutor', $hand[0]['name']);
        self::assertSame('Instant', $hand[0]['typeLine']);
        self::assertSame('https://cards.example/private-tutor-es.jpg', $hand[0]['imageUris']['normal']);
    }

    public function testProjectionLocalizesDoubleFacedCardFaceImagesWithoutChangingFaceMetadata(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $viewer = new User('viewer@example.test', 'Viewer');
        $viewer->updateCardLanguage('es');
        $snapshot = $this->snapshot($owner->id(), $viewer->id());
        $snapshot['players'][$owner->id()]['zones']['battlefield'] = [[
            ...$this->card('dfc-card', 'Front // Back'),
            'ownerId' => $owner->id(),
            'controllerId' => $owner->id(),
            'zone' => 'battlefield',
            'scryfallId' => 'dfc-print',
            'cardFaces' => [
                [
                    'name' => 'Front',
                    'typeLine' => 'Instant',
                    'oracleText' => 'Front text.',
                    'imageUris' => ['normal' => 'https://cards.example/front-en.jpg'],
                ],
                [
                    'name' => 'Back',
                    'typeLine' => 'Sorcery',
                    'oracleText' => 'Back text.',
                    'imageUris' => ['normal' => 'https://cards.example/back-en.jpg'],
                ],
            ],
        ]];
        $lookup = [
            'es' => [
                'dfc-print' => [
                    'imageUris' => ['normal' => 'https://cards.example/root-es.jpg'],
                    'cardFaces' => [
                        ['name' => 'Frente', 'typeLine' => 'Instantaneo', 'imageUris' => ['normal' => 'https://cards.example/front-es.jpg']],
                        ['name' => 'Reverso', 'typeLine' => 'Conjuro', 'imageUris' => ['normal' => 'https://cards.example/back-es.jpg']],
                    ],
                ],
            ],
        ];

        $card = (new GameProjectionService(new GameCommandHandler()))
            ->projectSnapshot($snapshot, $viewer, true, $lookup)['players'][$owner->id()]['zones']['battlefield'][0];

        self::assertSame('Front', $card['cardFaces'][0]['name']);
        self::assertSame('Instant', $card['cardFaces'][0]['typeLine']);
        self::assertSame('Back', $card['cardFaces'][1]['name']);
        self::assertSame('Sorcery', $card['cardFaces'][1]['typeLine']);
        self::assertSame('https://cards.example/front-es.jpg', $card['cardFaces'][0]['imageUris']['normal']);
        self::assertSame('https://cards.example/back-es.jpg', $card['cardFaces'][1]['imageUris']['normal']);
    }

    public function testProjectionUsesEachViewerLanguageImageForTheSameVisibleCard(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $snapshot = [
            ...$this->snapshot($owner->id(), $owner->id()),
            'players' => [
                $owner->id() => $this->player($owner->id(), []),
            ],
        ];
        $snapshot['players'][$owner->id()]['zones']['battlefield'] = [[
            ...$this->card('public-card', 'Sol Ring'),
            'ownerId' => $owner->id(),
            'controllerId' => $owner->id(),
            'zone' => 'battlefield',
            'scryfallId' => 'sol-ring-print',
            'typeLine' => 'Artifact',
            'revealedTo' => ['all'],
        ]];

        $languages = ['es', 'de', 'pt', 'en', 'it', 'ja'];
        $lookup = [];
        foreach ($languages as $language) {
            $viewer = new User($language.'@example.test', strtoupper($language));
            $viewer->updateCardLanguage($language);
            $snapshot['players'][$viewer->id()] = $this->player($viewer->id(), []);
            $lookup[$language]['sol-ring-print'] = [
                'name' => 'Localized name '.$language,
                'typeLine' => 'Localized type '.$language,
                'oracleText' => 'Localized text '.$language,
                'imageUris' => ['normal' => sprintf('https://cards.example/sol-ring-%s.jpg', $language)],
                'cardFaces' => [],
            ];

            $projected = (new GameProjectionService(new GameCommandHandler()))
                ->projectSnapshot($snapshot, $viewer, true, $lookup);
            $card = $projected['players'][$owner->id()]['zones']['battlefield'][0];

            self::assertSame('Sol Ring', $card['name']);
            self::assertSame('Artifact', $card['typeLine']);
            self::assertSame(sprintf('https://cards.example/sol-ring-%s.jpg', $language), $card['imageUris']['normal']);
        }
    }

    public function testProjectionLocalizesCardBackedSpecialEntitiesWithoutChangingHelperMetadata(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $viewer = new User('viewer@example.test', 'Viewer');
        $viewer->updateCardLanguage('es');
        $snapshot = $this->snapshot($owner->id(), $viewer->id());
        $snapshot['specialEntities'] = [[
            'id' => 'emblem-1',
            'template' => 'emblem',
            'scope' => 'player',
            'ownerPlayerId' => $owner->id(),
            'card' => [
                'scryfallId' => 'emblem-print',
                'name' => 'Gideon Emblem',
                'typeLine' => 'Emblem',
                'oracleText' => 'You get an emblem.',
                'layout' => 'emblem',
                'imageUris' => ['normal' => 'https://cards.example/emblem-en.jpg'],
                'cardFaces' => [[
                    'name' => 'Gideon Emblem',
                    'typeLine' => 'Emblem',
                    'oracleText' => 'You get an emblem.',
                    'imageUris' => ['normal' => 'https://cards.example/emblem-face-en.jpg'],
                ]],
            ],
            'state' => [],
            'createdAt' => '2026-01-01T00:00:00+00:00',
        ]];
        $lookup = [
            'es' => [
                'emblem-print' => [
                    'name' => 'Emblema de Gideon',
                    'typeLine' => 'Emblema',
                    'oracleText' => 'Obtienes un emblema.',
                    'imageUris' => ['normal' => 'https://cards.example/emblem-es.jpg'],
                    'cardFaces' => [[
                        'name' => 'Emblema de Gideon',
                        'typeLine' => 'Emblema',
                        'oracleText' => 'Obtienes un emblema.',
                        'imageUris' => ['normal' => 'https://cards.example/emblem-face-es.jpg'],
                    ]],
                ],
            ],
        ];

        $projected = (new GameProjectionService(new GameCommandHandler()))
            ->projectSnapshot($snapshot, $viewer, true, $lookup);

        self::assertSame('Gideon Emblem', $projected['specialEntities'][0]['card']['name']);
        self::assertSame('Emblem', $projected['specialEntities'][0]['card']['typeLine']);
        self::assertSame('https://cards.example/emblem-es.jpg', $projected['specialEntities'][0]['card']['imageUris']['normal']);
        self::assertSame(
            'https://cards.example/emblem-face-es.jpg',
            $projected['specialEntities'][0]['card']['cardFaces'][0]['imageUris']['normal'],
        );
    }

    public function testProjectedSnapshotPreservesGameplayContractFieldsForUiBootstrap(): void
    {
        $owner = new User('owner@example.test', 'Owner');
        $viewer = new User('viewer@example.test', 'Viewer');
        $snapshot = $this->snapshot($owner->id(), $viewer->id());
        $snapshot['updatedAt'] = '2026-01-01T00:01:00+00:00';
        $snapshot['counters'] = ['global' => ['storm' => 2]];
        $snapshot['stack'] = [[
            'id' => 'stack-1',
            'kind' => 'card',
            'card' => [
                ...$this->card('stack-card', 'Stack Spell'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'battlefield',
            ],
            'createdAt' => '2026-01-01T00:00:10+00:00',
        ]];
        $snapshot['arrows'] = [[
            'id' => 'arrow-1',
            'ownerId' => $owner->id(),
            'fromInstanceId' => 'face-down-permanent',
            'toInstanceId' => 'public-permanent',
            'color' => 'yellow',
            'createdAt' => '2026-01-01T00:00:20+00:00',
        ]];
        $snapshot['attachments'] = [[
            'id' => 'attachment-1',
            'ownerId' => $owner->id(),
            'equipmentInstanceId' => 'face-down-permanent',
            'attachedToInstanceId' => 'public-permanent',
            'createdAt' => '2026-01-01T00:00:30+00:00',
        ]];
        $snapshot['chat'] = [[
            'userId' => $owner->id(),
            'displayName' => 'Owner',
            'message' => 'public message',
            'targetPlayerId' => null,
            'targetDisplayName' => null,
            'createdAt' => '2026-01-01T00:00:40+00:00',
        ]];
        $snapshot['eventLog'] = [[
            'id' => 'log-1',
            'type' => 'zone.random_card.selected',
            'message' => 'Selected Public Permanent.',
            'actorId' => $owner->id(),
            'displayName' => 'Owner',
            'cardInstanceId' => 'public-permanent',
            'cardPlayerId' => $owner->id(),
            'cardZone' => 'battlefield',
            'createdAt' => '2026-01-01T00:00:50+00:00',
        ]];

        $snapshot['players'][$owner->id()] = [
            ...$snapshot['players'][$owner->id()],
            'backgroundName' => 'U_2',
            'sleevesName' => 'facedown_card',
            'colorIdentity' => ['U'],
            'commanderDamage' => [$viewer->id() => 4],
            'counters' => ['poison' => 1],
        ];
        $snapshot['players'][$owner->id()]['zones']['library'] = [[
            ...$this->card('library-top', 'Private Top'),
            'ownerId' => $owner->id(),
            'controllerId' => $owner->id(),
            'zone' => 'library',
            'revealedTo' => ['another-player'],
        ]];
        $snapshot['players'][$owner->id()]['zones']['battlefield'] = [
            [
                ...$this->card('face-down-permanent', 'Hidden Permanent'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'battlefield',
                'tapped' => true,
                'faceDown' => true,
                'position' => ['x' => 0.25, 'y' => 0.75, 'unit' => 'ratio'],
                'rotation' => 90,
                'counters' => ['shield' => 1],
            ],
            [
                ...$this->card('public-permanent', 'Public Permanent'),
                'ownerId' => $owner->id(),
                'controllerId' => $owner->id(),
                'zone' => 'battlefield',
                'faceDown' => false,
                'position' => ['x' => 0.5, 'y' => 0.5, 'unit' => 'ratio'],
                'revealedTo' => [$viewer->id()],
            ],
        ];

        $projected = (new GameProjectionService(new GameCommandHandler()))->projectSnapshot($snapshot, $viewer);
        $ownerProjection = $projected['players'][$owner->id()];

        self::assertSame(1, $projected['version']);
        self::assertSame($owner->id(), $projected['ownerId']);
        self::assertSame($snapshot['turn'], $projected['turn']);
        self::assertSame($snapshot['timer'] ?? null, $projected['timer'] ?? null);
        self::assertSame($snapshot['stack'], $projected['stack']);
        self::assertSame($snapshot['arrows'], $projected['arrows']);
        self::assertSame($snapshot['attachments'], $projected['attachments']);
        self::assertSame($snapshot['chat'], $projected['chat']);
        self::assertSame($snapshot['eventLog'], $projected['eventLog']);
        self::assertSame($snapshot['counters'], $projected['counters']);
        self::assertSame('2026-01-01T00:00:00+00:00', $projected['createdAt']);
        self::assertSame('2026-01-01T00:01:00+00:00', $projected['updatedAt']);

        self::assertSame('U_2', $ownerProjection['backgroundName']);
        self::assertSame('facedown_card', $ownerProjection['sleevesName']);
        self::assertSame(['U'], $ownerProjection['colorIdentity']);
        self::assertSame([$viewer->id() => 4], $ownerProjection['commanderDamage']);
        self::assertSame(['poison' => 1], $ownerProjection['counters']);
        self::assertSame(['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'], array_keys($ownerProjection['zones']));
        self::assertSame(1, $ownerProjection['zoneCounts']['library']);
        self::assertSame(5, $ownerProjection['zoneCounts']['hand']);
        self::assertSame(2, $ownerProjection['zoneCounts']['battlefield']);

        $libraryTop = $ownerProjection['zones']['library'][0];
        self::assertSame('Hidden card', $libraryTop['name']);
        self::assertSame($owner->id(), $libraryTop['ownerId']);
        self::assertSame($owner->id(), $libraryTop['controllerId']);
        self::assertTrue($libraryTop['hidden']);
        self::assertTrue($libraryTop['faceDown']);
        self::assertSame('library', $libraryTop['zone']);

        $faceDown = $ownerProjection['zones']['battlefield'][0];
        self::assertSame('Face-down card', $faceDown['name']);
        self::assertSame($owner->id(), $faceDown['ownerId']);
        self::assertSame($owner->id(), $faceDown['controllerId']);
        self::assertTrue($faceDown['hidden']);
        self::assertTrue($faceDown['tapped']);
        self::assertTrue($faceDown['faceDown']);
        self::assertSame(['x' => 0.25, 'y' => 0.75, 'unit' => 'ratio'], $faceDown['position']);
        self::assertSame(90, $faceDown['rotation']);
        self::assertSame(['shield' => 1], $faceDown['counters']);

        $publicPermanent = $ownerProjection['zones']['battlefield'][1];
        self::assertSame('public-permanent', $publicPermanent['instanceId']);
        self::assertSame($viewer->id(), $publicPermanent['revealedTo'][0]);
        self::assertFalse($publicPermanent['faceDown']);
    }

    private function snapshot(string $ownerId, string $viewerId): array
    {
        return [
            'version' => 1,
            'ownerId' => $ownerId,
            'players' => [
                $ownerId => $this->player($ownerId, [
                    [
                        ...$this->card('revealed-card', 'Revealed Tutor'),
                        'revealedTo' => [$viewerId],
                    ],
                    $this->card('hidden-before', 'Private Tutor'),
                    $this->card('hidden-after', 'Private Removal'),
                    $this->card('hidden-third', 'Private Ramp'),
                    $this->card('hidden-fourth', 'Private Land'),
                ]),
                $viewerId => $this->player($viewerId, []),
            ],
            'turn' => ['activePlayerId' => $ownerId, 'phase' => 'main', 'number' => 1],
            'stack' => [],
            'arrows' => [],
            'chat' => [],
            'eventLog' => [],
            'createdAt' => '2026-01-01T00:00:00+00:00',
        ];
    }

    /**
     * @param list<array<string,mixed>> $hand
     *
     * @return array<string,mixed>
     */
    private function player(string $playerId, array $hand): array
    {
        return [
            'user' => ['id' => $playerId, 'email' => $playerId.'@example.test', 'displayName' => $playerId, 'roles' => []],
            'life' => 40,
            'zones' => [
                'library' => [],
                'hand' => $hand,
                'battlefield' => [],
                'graveyard' => [],
                'exile' => [],
                'command' => [],
            ],
            'commanderDamage' => [],
            'counters' => [],
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function card(string $instanceId, string $name): array
    {
        return [
            'instanceId' => $instanceId,
            'ownerId' => null,
            'controllerId' => null,
            'name' => $name,
            'zone' => 'hand',
            'tapped' => false,
            'revealedTo' => [],
            'imageUris' => ['normal' => 'https://cards.example/'.$instanceId.'.jpg'],
        ];
    }
}
