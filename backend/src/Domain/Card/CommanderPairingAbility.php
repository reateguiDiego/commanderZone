<?php

namespace App\Domain\Card;

enum CommanderPairingAbility: string
{
    case None = 'none';
    case GenericPartner = 'generic_partner';
    case NamedPartner = 'named_partner';
    case FriendsForever = 'friends_forever';
    case ChooseBackground = 'choose_background';
    case DoctorsCompanion = 'doctors_companion';
}
