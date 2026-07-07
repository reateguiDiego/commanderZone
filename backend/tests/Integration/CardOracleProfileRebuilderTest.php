<?php

namespace App\Tests\Integration;

use App\Application\Card\CardOracleProfileRebuilder;

final class CardOracleProfileRebuilderTest extends ApiTestCase
{
    public function testGroupsMultiplePrintsByOracleIdAndPrefersEnglishBaseCard(): void
    {
        $oracleId = '70000000-0000-0000-0000-000000000001';
        $this->seedCard('70000000-0000-0000-0000-000000000011', 'Carta Localizada', [
            'oracle_id' => $oracleId,
            'lang' => 'es',
            'oracle_text' => 'Texto localizado.',
        ]);
        $this->seedCard('70000000-0000-0000-0000-000000000012', 'Canonical Card', [
            'oracle_id' => $oracleId,
            'lang' => 'en',
            'oracle_text' => 'Canonical rules text.',
        ]);

        $result = $this->rebuilder()->rebuild();

        self::assertSame(1, $result['profiles']);
        self::assertSame('1', (string) $this->entityManager->getConnection()->fetchOne('SELECT COUNT(*) FROM card_oracle_profile'));
        $profile = $this->entityManager->getConnection()->fetchAssociative('SELECT oracle_id, default_scryfall_id, name FROM card_oracle_profile');
        self::assertIsArray($profile);
        self::assertSame($oracleId, $profile['oracle_id']);
        self::assertSame('70000000-0000-0000-0000-000000000012', $profile['default_scryfall_id']);
        self::assertSame('Canonical Card', $profile['name']);
    }

    public function testCalculatesTypeAndCommanderBooleans(): void
    {
        $this->seedCard('70000000-0000-0000-0000-000000000021', 'Everything Type Card', [
            'oracle_id' => '70000000-0000-0000-0000-000000000101',
            'type_line' => 'Legendary Artifact Creature Enchantment Land Instant Sorcery Planeswalker Battle',
            'oracle_text' => '',
            'legalities' => ['commander' => 'legal'],
        ]);
        $this->seedCard('70000000-0000-0000-0000-000000000022', 'Banned Card', [
            'oracle_id' => '70000000-0000-0000-0000-000000000102',
            'type_line' => 'Sorcery',
            'oracle_text' => '',
            'legalities' => ['commander' => 'banned'],
        ]);
        $this->seedCard('70000000-0000-0000-0000-000000000023', 'Explicit Commander', [
            'oracle_id' => '70000000-0000-0000-0000-000000000103',
            'type_line' => 'Legendary Planeswalker',
            'oracle_text' => 'This planeswalker can be your commander.',
            'legalities' => ['commander' => 'legal'],
        ]);

        $this->rebuilder()->rebuild();

        $typeProfile = $this->booleanProfile('70000000-0000-0000-0000-000000000101');
        self::assertSame(1, $typeProfile['commander_legal']);
        self::assertSame(0, $typeProfile['commander_banned']);
        self::assertSame(1, $typeProfile['can_be_commander']);
        self::assertSame(1, $typeProfile['is_land']);
        self::assertSame(1, $typeProfile['is_creature']);
        self::assertSame(1, $typeProfile['is_artifact']);
        self::assertSame(1, $typeProfile['is_enchantment']);
        self::assertSame(1, $typeProfile['is_instant']);
        self::assertSame(1, $typeProfile['is_sorcery']);
        self::assertSame(1, $typeProfile['is_planeswalker']);
        self::assertSame(1, $typeProfile['is_battle']);
        self::assertSame(1, $typeProfile['is_legendary']);

        $bannedProfile = $this->booleanProfile('70000000-0000-0000-0000-000000000102');
        self::assertSame(0, $bannedProfile['commander_legal']);
        self::assertSame(1, $bannedProfile['commander_banned']);
        self::assertSame(0, $bannedProfile['can_be_commander']);

        $explicitProfile = $this->booleanProfile('70000000-0000-0000-0000-000000000103');
        self::assertSame(1, $explicitProfile['can_be_commander']);
    }

    public function testDoesNotUpdateProfileWhenDataHashIsUnchanged(): void
    {
        $oracleId = '70000000-0000-0000-0000-000000000201';
        $this->seedCard('70000000-0000-0000-0000-000000000031', 'Stable Profile Card', [
            'oracle_id' => $oracleId,
            'type_line' => 'Artifact',
            'oracle_text' => 'Stable text.',
            'keywords' => ['Ward'],
            'edhrec_rank' => 42,
        ]);

        $firstResult = $this->rebuilder()->rebuild();
        self::assertSame(1, $firstResult['changed']);

        $this->entityManager->getConnection()->executeStatement(
            "UPDATE card_oracle_profile SET updated_at = TIMESTAMP '2000-01-01 00:00:00' WHERE oracle_id = :oracleId",
            ['oracleId' => $oracleId],
        );
        $oldTimestamp = $this->profileTimestamp($oracleId);

        $secondResult = $this->rebuilder()->rebuild();

        self::assertSame(0, $secondResult['changed']);
        self::assertSame($oldTimestamp, $this->profileTimestamp($oracleId));
    }

    public function testOutOfRangeManaValueDoesNotBreakNumericProfileColumn(): void
    {
        $oracleId = '70000000-0000-0000-0000-000000000301';
        $this->seedCard('70000000-0000-0000-0000-000000000041', 'Giant Mana Value Card', [
            'oracle_id' => $oracleId,
            'mana_value' => 1000000,
        ]);

        $result = $this->rebuilder()->rebuild();

        self::assertSame(1, $result['profiles']);
        self::assertNull($this->entityManager->getConnection()->fetchOne(
            'SELECT mana_value FROM card_oracle_profile WHERE oracle_id = :oracleId',
            ['oracleId' => $oracleId],
        ));
    }

    private function rebuilder(): CardOracleProfileRebuilder
    {
        return new CardOracleProfileRebuilder($this->entityManager->getConnection());
    }

    /**
     * @return array<string,int>
     */
    private function booleanProfile(string $oracleId): array
    {
        $row = $this->entityManager->getConnection()->fetchAssociative(
            <<<'SQL'
SELECT
    CASE WHEN commander_legal THEN 1 ELSE 0 END AS commander_legal,
    CASE WHEN commander_banned THEN 1 ELSE 0 END AS commander_banned,
    CASE WHEN can_be_commander THEN 1 ELSE 0 END AS can_be_commander,
    CASE WHEN is_land THEN 1 ELSE 0 END AS is_land,
    CASE WHEN is_creature THEN 1 ELSE 0 END AS is_creature,
    CASE WHEN is_artifact THEN 1 ELSE 0 END AS is_artifact,
    CASE WHEN is_enchantment THEN 1 ELSE 0 END AS is_enchantment,
    CASE WHEN is_instant THEN 1 ELSE 0 END AS is_instant,
    CASE WHEN is_sorcery THEN 1 ELSE 0 END AS is_sorcery,
    CASE WHEN is_planeswalker THEN 1 ELSE 0 END AS is_planeswalker,
    CASE WHEN is_battle THEN 1 ELSE 0 END AS is_battle,
    CASE WHEN is_legendary THEN 1 ELSE 0 END AS is_legendary
FROM card_oracle_profile
WHERE oracle_id = :oracleId
SQL,
            ['oracleId' => $oracleId],
        );
        self::assertIsArray($row);

        return array_combine(
            array_keys($row),
            array_map(static fn (mixed $value): int => (int) $value, array_values($row)),
        );
    }

    private function profileTimestamp(string $oracleId): string
    {
        return (string) $this->entityManager->getConnection()->fetchOne(
            "SELECT to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS') FROM card_oracle_profile WHERE oracle_id = :oracleId",
            ['oracleId' => $oracleId],
        );
    }
}
