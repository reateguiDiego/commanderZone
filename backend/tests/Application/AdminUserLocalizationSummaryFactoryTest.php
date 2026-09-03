<?php

namespace App\Tests\Application;

use App\Application\User\AdminUserLocalizationSummaryFactory;
use App\Application\User\CountryContinentResolver;
use PHPUnit\Framework\TestCase;

final class AdminUserLocalizationSummaryFactoryTest extends TestCase
{
    public function testItSeparatesAllUsersAndActiveUsersAcrossEveryLocalizationDimension(): void
    {
        $summary = (new AdminUserLocalizationSummaryFactory(new CountryContinentResolver()))->create([
            ['countryCode' => 'ES', 'countryName' => 'Spain', 'appLanguage' => 'es', 'isActive' => true],
            ['countryCode' => 'BR', 'countryName' => 'Brazil', 'appLanguage' => 'pt', 'isActive' => true],
            ['countryCode' => 'DE', 'countryName' => 'Germany', 'appLanguage' => 'de', 'isActive' => false],
        ]);

        self::assertSame(3, $summary['all']['totalUsers']);
        self::assertSame([
            ['code' => 'BR', 'name' => 'Brazil', 'userCount' => 1, 'share' => 33],
            ['code' => 'DE', 'name' => 'Germany', 'userCount' => 1, 'share' => 33],
            ['code' => 'ES', 'name' => 'Spain', 'userCount' => 1, 'share' => 33],
        ], $summary['all']['countries']);
        self::assertSame([
            ['code' => 'EU', 'name' => 'Europe', 'userCount' => 2, 'share' => 67],
            ['code' => 'SA', 'name' => 'South America', 'userCount' => 1, 'share' => 33],
        ], $summary['all']['continents']);

        self::assertSame(2, $summary['active']['totalUsers']);
        self::assertSame([
            ['code' => 'BR', 'name' => 'Brazil', 'userCount' => 1, 'share' => 50],
            ['code' => 'ES', 'name' => 'Spain', 'userCount' => 1, 'share' => 50],
        ], $summary['active']['countries']);
        self::assertSame([
            ['code' => 'es', 'name' => 'es', 'userCount' => 1, 'share' => 50],
            ['code' => 'pt', 'name' => 'pt', 'userCount' => 1, 'share' => 50],
        ], $summary['active']['languages']);
    }

    public function testItKeepsUnknownLocalizationDataInAnExplicitGroup(): void
    {
        $summary = (new AdminUserLocalizationSummaryFactory(new CountryContinentResolver()))->create([
            ['countryCode' => null, 'countryName' => null, 'appLanguage' => '', 'isActive' => false],
        ]);

        self::assertSame([
            ['code' => null, 'name' => null, 'userCount' => 1, 'share' => 100],
        ], $summary['all']['countries']);
        self::assertSame([
            ['code' => null, 'name' => null, 'userCount' => 1, 'share' => 100],
        ], $summary['all']['continents']);
        self::assertSame([
            ['code' => null, 'name' => null, 'userCount' => 1, 'share' => 100],
        ], $summary['all']['languages']);
        self::assertSame(0, $summary['active']['totalUsers']);
    }
}
