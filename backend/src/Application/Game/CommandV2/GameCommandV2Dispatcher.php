<?php

namespace App\Application\Game\CommandV2;

use App\Application\Game\GameCommandHandler;
use App\Domain\User\User;

final class GameCommandV2Dispatcher
{
    /**
     * @var list<GameCommandV2ApplierInterface>
     */
    private array $appliers;

    /**
     * @param iterable<GameCommandV2ApplierInterface>|null $appliers
     */
    public function __construct(?iterable $appliers = null)
    {
        $this->appliers = $appliers === null
            ? [
                new LifeChangedCommandV2Applier(),
                new TurnChangedCommandV2Applier(),
                new DiceRolledCommandV2Applier(),
                new CounterChangedCommandV2Applier(),
                new CardTappedCommandV2Applier(),
                new CardCounterChangedCommandV2Applier(),
                new CardPowerToughnessChangedCommandV2Applier(),
                new CardPositionChangedCommandV2Applier(),
                new CardMovedCommandV2Applier(),
                new CardsMovedCommandV2Applier(),
                new ZoneChangedCommandV2Applier(),
                new ZoneMoveAllCommandV2Applier(),
                new ZoneRandomCardSelectedCommandV2Applier(),
                new BattlefieldUntapAllCommandV2Applier(),
                new CardsPositionChangedCommandV2Applier(),
                new LibraryDrawCommandV2Applier(),
                new LibraryRevealTopCommandV2Applier(),
            ]
            : array_values(array_filter(
                iterator_to_array($appliers),
                static fn (mixed $applier): bool => $applier instanceof GameCommandV2ApplierInterface,
            ));
    }

    public function supports(string $type): bool
    {
        foreach ($this->appliers as $applier) {
            if ($applier->supports($type)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string,mixed> $snapshot
     * @param array<string,mixed> $payload
     */
    public function apply(string $type, array &$snapshot, array $payload, User $actor, GameCommandHandler $helper): ?GameCommandV2Result
    {
        foreach ($this->appliers as $applier) {
            if ($applier->supports($type)) {
                return $applier->apply($snapshot, $payload, $actor, $helper);
            }
        }

        return null;
    }
}
