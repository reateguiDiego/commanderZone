<?php

namespace App\Tests\Application;

use App\Application\Card\CardLocalizationService;
use App\Domain\Card\Card;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\EntityRepository;
use Doctrine\ORM\Query;
use Doctrine\ORM\QueryBuilder;
use PHPUnit\Framework\TestCase;

class CardLocalizationServiceTest extends TestCase
{
    public function testSelectsExactLocalizedPrintWhenSetAndCollectorMatch(): void
    {
        $source = $this->card('src-sol-ring-en', 'Sol Ring', 'en', 'lea', '233', null, null, 'Artifact', 'highres_scan');
        $exactSpanish = $this->card('sol-ring-es-exact', 'Sol Ring', 'es', 'lea', '233', 'Anillo solar', null, 'Artifact', 'highres_scan');
        $alternateSpanish = $this->card('sol-ring-es-alt', 'Sol Ring', 'es', '2xm', '302', 'Anillo solar', null, 'Artifact', 'highres_scan');

        $service = $this->serviceWithCards([$source, $exactSpanish, $alternateSpanish]);

        $localized = $service->localizeCard($source, 'es');

        self::assertSame('sol-ring-es-exact', $localized->scryfallId());
        self::assertSame('es', $localized->lang());
        self::assertSame('Anillo solar', $localized->printedName());
    }

    public function testFallsBackToRequestedLanguageAcrossDifferentPrintWhenExactPrintDoesNotExist(): void
    {
        $source = $this->card('src-sol-ring-en', 'Sol Ring', 'en', 'lea', '233', null, null, 'Artifact', 'highres_scan');
        $alternateSpanish = $this->card('sol-ring-es-alt', 'Sol Ring', 'es', '2xm', '302', 'Anillo solar', null, 'Artifact', 'highres_scan');

        $service = $this->serviceWithCards([$source, $alternateSpanish]);

        $localized = $service->localizeCard($source, 'es');

        self::assertSame('sol-ring-es-alt', $localized->scryfallId());
        self::assertSame('es', $localized->lang());
        self::assertSame('Anillo solar', $localized->printedName());
    }

    public function testFallsBackToEnglishWhenRequestedLanguageIsUnavailable(): void
    {
        $source = $this->card('src-sol-ring-it', 'Sol Ring', 'it', null, null, 'Anello Solare');
        $english = $this->card('sol-ring-en-alt', 'Sol Ring', 'en', 'lea', '233', null, null, 'Artifact', 'highres_scan');

        $service = $this->serviceWithCards([$source, $english]);

        $localized = $service->localizeCard($source, 'es');

        self::assertSame('sol-ring-en-alt', $localized->scryfallId());
        self::assertSame('en', $localized->lang());
        self::assertSame('Sol Ring', $localized->name());
    }

    public function testDoesNotFallbackToCommonPrintLanguageWhenRequestedLanguageAndEnglishAreUnavailable(): void
    {
        $source = $this->card('src-sol-ring-it', 'Sol Ring', 'it', null, null, 'Anello Solare');
        $commonLanguagePrint = $this->card('sol-ring-ph-alt', 'Sol Ring', 'ph', 'lea', '233', 'Sol Ring PH', null, 'Artifact', 'highres_scan');

        $service = $this->serviceWithCards([$source, $commonLanguagePrint]);

        $localized = $service->localizeCard($source, 'es');

        self::assertSame('src-sol-ring-it', $localized->scryfallId());
        self::assertSame('it', $localized->lang());
    }

    public function testFallsBackToEnglishWhenRequestedCandidateHasPlaceholderImageStatus(): void
    {
        $source = $this->card(
            'src-arcane-denial-en',
            'Arcane Denial',
            'en',
            'ice',
            '67',
            null,
            'Counter target spell. Its controller may draw up to two cards at the beginning of the next turn\'s upkeep.',
            'Instant',
            'highres_scan',
        );
        $placeholderSpanish = $this->card(
            'arcane-denial-es-placeholder',
            'Arcane Denial',
            'es',
            'sld',
            '1',
            'Negacion Arcana',
            'Contrarresta el hechizo objetivo.',
            'Instant',
            'placeholder',
        );
        $english = $this->card(
            'arcane-denial-en-real',
            'Arcane Denial',
            'en',
            'ice',
            '67',
            null,
            'Counter target spell. Its controller may draw up to two cards at the beginning of the next turn\'s upkeep.',
            'Instant',
            'highres_scan',
        );

        $service = $this->serviceWithCards([$source, $placeholderSpanish, $english]);

        $localized = $service->localizeCard($source, 'es');

        self::assertSame('src-arcane-denial-en', $localized->scryfallId());
        self::assertSame('en', $localized->lang());
    }

    /**
     * @param list<Card> $cards
     */
    private function serviceWithCards(array $cards): CardLocalizationService
    {
        $repository = $this->getMockBuilder(EntityRepository::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['createQueryBuilder'])
            ->getMock();
        $repository
            ->method('createQueryBuilder')
            ->willReturnCallback(fn (): QueryBuilder => $this->queryBuilderWithCards($cards));

        $entityManager = $this->createMock(EntityManagerInterface::class);
        $entityManager
            ->method('getRepository')
            ->willReturn($repository);

        return new CardLocalizationService($entityManager);
    }

    /**
     * @param list<Card> $cards
     */
    private function queryBuilderWithCards(array $cards): QueryBuilder
    {
        $parameters = [];
        $query = $this->getMockBuilder(Query::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['getResult'])
            ->getMock();
        $query
            ->method('getResult')
            ->willReturnCallback(function () use ($cards, &$parameters): array {
                if (isset($parameters['ids']) && is_array($parameters['ids'])) {
                    $ids = array_values(array_filter(
                        $parameters['ids'],
                        static fn (mixed $id): bool => is_string($id) && $id !== '',
                    ));

                    return array_values(array_filter(
                        $cards,
                        static fn (Card $card): bool => in_array($card->scryfallId(), $ids, true),
                    ));
                }

                if (
                    isset($parameters['names'], $parameters['languages'])
                    && is_array($parameters['names'])
                    && is_array($parameters['languages'])
                ) {
                    $names = array_values(array_filter(
                        $parameters['names'],
                        static fn (mixed $name): bool => is_string($name) && $name !== '',
                    ));
                    $languages = array_values(array_filter(
                        $parameters['languages'],
                        static fn (mixed $language): bool => is_string($language) && $language !== '',
                    ));

                    return array_values(array_filter(
                        $cards,
                        static fn (Card $card): bool => in_array($card->normalizedName(), $names, true)
                            && in_array((string) $card->lang(), $languages, true),
                    ));
                }

                return [];
            });

        $queryBuilder = $this->getMockBuilder(QueryBuilder::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['andWhere', 'setParameter', 'orderBy', 'addOrderBy', 'getQuery'])
            ->getMock();
        $queryBuilder->method('andWhere')->willReturnSelf();
        $queryBuilder
            ->method('setParameter')
            ->willReturnCallback(function (mixed $name, mixed $value) use (&$parameters, $queryBuilder): QueryBuilder {
                if (is_string($name)) {
                    $parameters[$name] = $value;
                }

                return $queryBuilder;
            });
        $queryBuilder->method('orderBy')->willReturnSelf();
        $queryBuilder->method('addOrderBy')->willReturnSelf();
        $queryBuilder->method('getQuery')->willReturn($query);

        return $queryBuilder;
    }

    private function card(
        string $scryfallId,
        string $name,
        string $lang,
        ?string $setCode,
        ?string $collectorNumber,
        ?string $printedName = null,
        ?string $oracleText = null,
        string $typeLine = 'Artifact',
        ?string $imageStatus = null,
    ): Card {
        $card = new Card($scryfallId);
        $card->updateFromScryfall([
            'id' => $scryfallId,
            'name' => $name,
            'lang' => $lang,
            'set' => $setCode,
            'collector_number' => $collectorNumber,
            'printed_name' => $printedName,
            'image_status' => $imageStatus,
            'type_line' => $typeLine,
            'oracle_text' => $oracleText,
            'legalities' => ['commander' => 'legal'],
            'colors' => [],
            'color_identity' => [],
            'image_uris' => [],
            'card_faces' => [],
            'all_parts' => [],
            'produced_mana' => [],
            'prices' => [],
            'layout' => 'normal',
        ]);

        return $card;
    }
}
