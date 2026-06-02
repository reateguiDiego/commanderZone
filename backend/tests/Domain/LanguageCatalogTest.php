<?php

namespace App\Tests\Domain;

use App\Domain\Localization\LanguageCatalog;
use PHPUnit\Framework\TestCase;

class LanguageCatalogTest extends TestCase
{
    public function testCommonPrintLanguagesAreExposedAsFixedCatalog(): void
    {
        self::assertSame(['ph', 'qya', 'grc', 'he', 'sa', 'ar'], LanguageCatalog::commonPrintLanguages());
    }

    public function testRecognizesCommonPrintLanguageCodes(): void
    {
        self::assertTrue(LanguageCatalog::isCommonPrintLanguage('ph'));
        self::assertTrue(LanguageCatalog::isCommonPrintLanguage('ar'));
        self::assertFalse(LanguageCatalog::isCommonPrintLanguage('es'));
        self::assertFalse(LanguageCatalog::isCommonPrintLanguage(null));
    }
}
