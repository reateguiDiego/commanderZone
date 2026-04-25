<?php

namespace App\Tests\Domain;

use App\Domain\Card\Card;
use PHPUnit\Framework\TestCase;

class CardImageTest extends TestCase
{
    public function testReturnsImageUriForKnownFormat(): void
    {
        $card = new Card('00000000-0000-0000-0000-000000000001');
        $card->updateFromScryfall([
            'name' => 'Sol Ring',
            'image_uris' => [
                'normal' => 'https://cards.scryfall.io/normal/front/0/0/00000000-0000-0000-0000-000000000001.jpg',
            ],
        ]);

        self::assertSame(
            'https://cards.scryfall.io/normal/front/0/0/00000000-0000-0000-0000-000000000001.jpg',
            $card->imageUri('normal'),
        );
        self::assertNull($card->imageUri('art_crop'));
    }

    public function testStoresLocalizationFieldsFromScryfall(): void
    {
        $card = new Card('00000000-0000-0000-0000-000000000002');
        $card->updateFromScryfall([
            'name' => 'Swords to Plowshares',
            'lang' => 'es',
            'printed_name' => 'Espadas en guadañas',
            'flavor_name' => 'Alternate flavor',
        ]);

        $data = $card->toArray();

        self::assertSame('es', $data['lang']);
        self::assertSame('Espadas en guadañas', $data['printedName']);
        self::assertSame('Alternate flavor', $data['flavorName']);
    }
}
