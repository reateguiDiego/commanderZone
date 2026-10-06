<?php

namespace App\Tests\Integration;

use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Infrastructure\Observability\RequestPerformanceContext;
use PHPUnit\Framework\Attributes\DataProvider;

final class DeckReadQueryCountTest extends ApiTestCase
{
    public static function routes(): iterable
    {
        yield 'detail' => ['detail'];
        yield 'slug' => ['slug'];
        yield 'sections' => ['sections'];
    }

    #[DataProvider('routes')]
    public function testReadingManyDistinctCardsDoesNotIssueOneQueryPerCard(string $route): void
    {
        $token = $this->registerAndLogin();
        $this->jsonRequest('POST', '/decks', ['name' => 'Read Query Budget'], $token);
        self::assertResponseStatusCodeSame(201);
        $created = $this->jsonResponse()['deck'];
        $deck = $this->entityManager->find(Deck::class, $created['id']);
        self::assertInstanceOf(Deck::class, $deck);
        $expected = [];
        for ($i = 0; $i < 30; ++$i) {
            $card = $this->seedCard('read-card-'.$i, 'Read Card '.$i);
            $line = new DeckCard($deck, $card, $i + 1, DeckCard::SECTIONS[$i % 4]);
            $deck->addCard($line);
            $this->entityManager->persist($line);
            $expected[$line->id()] = [$i + 1, $line->section(), $card->scryfallId()];
        }
        $this->entityManager->flush();
        $this->entityManager->clear();
        $url = $route === 'slug' ? '/decks/by-slug/'.$created['slug'] : '/decks/'.$created['id'];
        if ($route === 'sections') {
            $url .= '/sections';
        }

        $this->jsonRequest('GET', $url, token: $token);
        self::assertResponseIsSuccessful();
        $metrics = static::getContainer()->get(RequestPerformanceContext::class)->metrics();
        $payload = $this->jsonResponse();
        $lines = $route === 'sections'
            ? array_merge(...array_map(fn (string $section): array => $payload['sections'][$section], DeckCard::SECTIONS))
            : $payload['deck']['cards'];
        $actual = [];
        foreach ($lines as $line) {
            $actual[$line['id']] = [$line['quantity'], $line['section'], $line['card']['scryfallId']];
        }
        ksort($expected);
        ksort($actual);
        self::assertSame($expected, $actual);
        // Sections also resolve tokens and localize each section independently.
        // Their fixed work is larger, but neither budget allows 30 lazy card reads.
        self::assertLessThan($route === 'sections' ? 36 : 20, $metrics['query_count'], 'Reads must batch cards rather than query every card separately.');
        if ($route === 'sections') {
            self::assertSame(2, $metrics['stages']['deck.sections.cards']['queries']);
            foreach (['load', 'cards', 'tokens', 'localization', 'response'] as $stage) {
                self::assertSame(1, $metrics['stages']['deck.sections.'.$stage]['calls']);
            }
        }

        $otherToken = $this->registerAndLogin('other-reader@example.test', 'Other Reader');
        $this->jsonRequest('GET', $url, token: $otherToken);
        self::assertResponseStatusCodeSame(404);
    }

    #[DataProvider('routes')]
    public function testEmptyDeckIsStillReadable(string $route): void
    {
        $token = $this->registerAndLogin();
        $this->jsonRequest('POST', '/decks', ['name' => 'Empty'], $token);
        self::assertResponseStatusCodeSame(201);
        $created = $this->jsonResponse()['deck'];
        $url = $route === 'slug' ? '/decks/by-slug/'.$created['slug'] : '/decks/'.$created['id'];
        $this->jsonRequest('GET', $url.($route === 'sections' ? '/sections' : ''), token: $token);
        self::assertResponseIsSuccessful();
        $payload = $this->jsonResponse();
        if ($route === 'sections') {
            foreach ($payload['sections'] as $lines) {
                self::assertSame([], $lines);
            }
            self::assertSame(0, $payload['counts']['playableTotal']);
        } else {
            self::assertSame([], $payload['deck']['cards']);
        }
    }
}
