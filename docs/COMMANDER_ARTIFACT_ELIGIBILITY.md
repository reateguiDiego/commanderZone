# Legendary artifact commanders

Commander rule 903.3 permits legendary Vehicles and legendary Spacecraft with a printed power/toughness box, in addition to the existing creature and explicit-exception rules.
Source: https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt

The fix covers candidate searches, the add-to-deck selector, decklist commander inference, deck validation and oracle profile rebuilding. It does not automate crew/station or change pairing, deck size, singleton, color identity or ban checks. A qualifying back face alone is insufficient for the new artifact cases.

## Existing data

Migration Version20261103120000 replaces the community partial commander index using concurrent index operations. It is nontransactional and must run outside a wrapping transaction, like the original index migration.

Existing decks previously marked invalid should be validated again through the normal editor action. No saved deck composition is changed by the fix.

The existing search page cache expires after five minutes. Existing analysis profiles can be refreshed using the established commands (in this order):

    php bin/console app:deck-analysis:oracle-profile:rebuild
    php bin/console app:deck-analysis:card-analysis-profile:rebuild

These rebuilds update derived analysis data; selection and deck validation use card data directly. No production commands were executed while preparing this fix.

## Regression coverage

Tests cover Hearthhull import and validation, candidate search, derived profiles, the commander section in the modal and placement in the initial command zone. Negative cases retain rejection of nonlegendary spacecraft, spacecraft lacking power/toughness and generic legendary artifacts. Existing color identity and banned-card checks remain enforced.
