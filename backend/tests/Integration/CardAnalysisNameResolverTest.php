<?php

namespace App\Tests\Integration;

use App\Application\Card\CardOracleProfileRebuilder;
use App\Application\Deck\CardAnalysisNameResolver;
use App\Application\Deck\CardAnalysisProfileRebuilder;

final class CardAnalysisNameResolverTest extends ApiTestCase
{
    public function testResolvesFrontFaceNamesForMdfcAndAdventureCards(): void
    {
        $this->seedAnalysisCard('86000000-0000-0000-0000-000000000001', '86000000-0000-0000-0000-000000000101', 'Malakir Rebirth // Malakir Mire', true, ['Malakir Rebirth', 'Malakir Mire']);
        $this->seedAnalysisCard('86000000-0000-0000-0000-000000000002', '86000000-0000-0000-0000-000000000102', 'Bala Ged Recovery // Bala Ged Sanctuary', true, ['Bala Ged Recovery', 'Bala Ged Sanctuary']);
        $this->seedAnalysisCard('86000000-0000-0000-0000-000000000003', '86000000-0000-0000-0000-000000000103', 'Murderous Rider // Swift End', true, ['Murderous Rider', 'Swift End']);
        $this->rebuildProfiles();

        $resolver = new CardAnalysisNameResolver($this->entityManager->getConnection());

        self::assertSame('86000000-0000-0000-0000-000000000101', $resolver->resolve('Malakir Rebirth')['oracle_id'] ?? null);
        self::assertSame('86000000-0000-0000-0000-000000000102', $resolver->resolve('Bala Ged Recovery')['oracle_id'] ?? null);
        self::assertSame('86000000-0000-0000-0000-000000000103', $resolver->resolve('Murderous Rider')['oracle_id'] ?? null);
    }

    public function testPrefersCommanderLegalCandidateWhenDigitalVariantSharesFrontFace(): void
    {
        $this->seedAnalysisCard('86000000-0000-0000-0000-000000000004', '86000000-0000-0000-0000-000000000104', 'Birgi, God of Storytelling // Birgi, God of Storytelling', false, ['Birgi, God of Storytelling']);
        $this->seedAnalysisCard('86000000-0000-0000-0000-000000000005', '86000000-0000-0000-0000-000000000105', 'Birgi, God of Storytelling // Harnfel, Horn of Bounty', true, ['Birgi, God of Storytelling', 'Harnfel, Horn of Bounty']);
        $this->seedAnalysisCard('86000000-0000-0000-0000-000000000006', '86000000-0000-0000-0000-000000000106', 'Tergrid, God of Fright // Tergrid\'s Lantern', true, ['Tergrid, God of Fright', 'Tergrid\'s Lantern']);
        $this->seedAnalysisCard('86000000-0000-0000-0000-000000000007', '86000000-0000-0000-0000-000000000107', 'Tergrid, God of Fright // Tergrid, God of Fright', false, ['Tergrid, God of Fright']);
        $this->rebuildProfiles();

        $resolver = new CardAnalysisNameResolver($this->entityManager->getConnection());

        self::assertSame('86000000-0000-0000-0000-000000000105', $resolver->resolve('Birgi, God of Storytelling')['oracle_id'] ?? null);
        self::assertSame('86000000-0000-0000-0000-000000000106', $resolver->resolve('Tergrid, God of Fright')['oracle_id'] ?? null);
    }

    public function testReturnsAmbiguousWhenMultipleCommanderLegalCandidatesRemain(): void
    {
        $this->seedAnalysisCard('86000000-0000-0000-0000-000000000008', '86000000-0000-0000-0000-000000000108', 'Shared Front // First Back', true, ['Shared Front', 'First Back']);
        $this->seedAnalysisCard('86000000-0000-0000-0000-000000000009', '86000000-0000-0000-0000-000000000109', 'Shared Front // Second Back', true, ['Shared Front', 'Second Back']);
        $this->rebuildProfiles();

        $result = (new CardAnalysisNameResolver($this->entityManager->getConnection()))->resolve('Shared Front');

        self::assertSame('ambiguous', $result['status']);
        self::assertCount(2, $result['candidates']);
    }

    public function testResolvesOfficialLeadingArticleWhenDeckNameOmitsIt(): void
    {
        $this->seedAnalysisCard('86000000-0000-0000-0000-000000000010', '86000000-0000-0000-0000-000000000110', 'The Meathook Massacre', true, ['The Meathook Massacre']);
        $this->rebuildProfiles();

        $result = (new CardAnalysisNameResolver($this->entityManager->getConnection()))->resolve('Meathook Massacre');

        self::assertSame('resolved', $result['status']);
        self::assertSame('86000000-0000-0000-0000-000000000110', $result['oracle_id']);
    }

    public function testIgnoresAlchemyRebalancedNamesWhenResolvingDeckCards(): void
    {
        $this->seedAnalysisCard('86000000-0000-0000-0000-000000000011', '86000000-0000-0000-0000-000000000111', 'A-Narfi, Betrayer King', false, ['A-Narfi, Betrayer King']);
        $this->rebuildProfiles();

        $result = (new CardAnalysisNameResolver($this->entityManager->getConnection()))->resolve('A-Narfi, Betrayer King');

        self::assertSame('missing', $result['status']);
    }

    public function testIgnoresCardsOutsideCommanderSearchScope(): void
    {
        $this->seedAnalysisCard('86000000-0000-0000-0000-000000000014', '86000000-0000-0000-0000-000000000114', 'Alexander Clamilton', false, ['Alexander Clamilton']);
        $this->rebuildProfiles();

        $result = (new CardAnalysisNameResolver($this->entityManager->getConnection()))->resolve('Alexander Clamilton');

        self::assertSame('missing', $result['status']);
    }

    public function testIgnoresPrepareFacesWhenARealCommanderCardHasTheSameName(): void
    {
        $this->seedAnalysisCard('86000000-0000-0000-0000-000000000012', '86000000-0000-0000-0000-000000000112', 'Seething Song', true, ['Seething Song']);
        $this->seedAnalysisCard('86000000-0000-0000-0000-000000000013', '86000000-0000-0000-0000-000000000113', 'Blazing Firesinger // Seething Song', true, ['Blazing Firesinger', 'Seething Song'], ['layout' => 'prepare']);
        $this->rebuildProfiles();

        $result = (new CardAnalysisNameResolver($this->entityManager->getConnection()))->resolve('Seething Song');

        self::assertSame('resolved', $result['status']);
        self::assertSame('86000000-0000-0000-0000-000000000112', $result['oracle_id']);
    }

    /**
     * @param list<string> $faceNames
     * @param array<string,mixed> $overrides
     */
    private function seedAnalysisCard(string $scryfallId, string $oracleId, string $name, bool $commanderLegal, array $faceNames, array $overrides = []): void
    {
        $this->seedCard($scryfallId, $name, array_replace([
            'oracle_id' => $oracleId,
            'type_line' => 'Creature',
            'oracle_text' => 'Test card.',
            'legalities' => ['commander' => $commanderLegal ? 'legal' : 'not_legal'],
            'card_faces' => array_map(
                static fn (string $faceName): array => [
                    'name' => $faceName,
                    'type_line' => 'Creature',
                    'oracle_text' => 'Test face.',
                ],
                $faceNames,
            ),
        ], $overrides));
    }

    private function rebuildProfiles(): void
    {
        (new CardOracleProfileRebuilder($this->entityManager->getConnection()))->rebuild();
        (new CardAnalysisProfileRebuilder($this->entityManager->getConnection()))->rebuild();
    }
}
