<?php

namespace App\Infrastructure\Community;

use App\Application\Community\CommunityCache;
use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckCard;
use App\Domain\User\User;
use Doctrine\Bundle\DoctrineBundle\Attribute\AsDoctrineListener;
use Doctrine\ORM\Event\OnFlushEventArgs;
use Doctrine\ORM\Event\PostFlushEventArgs;
use Doctrine\ORM\Events;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Contracts\Service\ResetInterface;

#[AsDoctrineListener(event: Events::onFlush)]
#[AsDoctrineListener(event: Events::postFlush)]
final class CommunityCacheInvalidator implements EventSubscriberInterface, ResetInterface
{
    private array $tags = [];
    private ?\Doctrine\DBAL\Connection $connection = null;

    public function __construct(private readonly CommunityCache $cache) {}

    public function onFlush(OnFlushEventArgs $event): void
    {
        $this->connection = $event->getObjectManager()->getConnection();
        $uow = $event->getObjectManager()->getUnitOfWork();
        foreach ([...$uow->getScheduledEntityInsertions(), ...$uow->getScheduledEntityUpdates(), ...$uow->getScheduledEntityDeletions()] as $entity) {
            $deck = $entity instanceof DeckCard ? $entity->deck() : $entity;
            if ($deck instanceof Deck) {
                $this->tags[] = 'community.home';
                $this->tags[] = 'community.decks';
                $this->tags[] = 'community.user.'.$deck->owner()->id();
            } elseif ($entity instanceof User) {
                $this->tags[] = 'community.user.'.$entity->id();
            }
        }
    }

    public function postFlush(PostFlushEventArgs $event): void
    {
        $this->publishIfCommitted();
    }

    public static function getSubscribedEvents(): array
    {
        return [KernelEvents::RESPONSE => ['onResponse', -1024]];
    }

    public function onResponse(ResponseEvent $event): void
    {
        if ($event->isMainRequest()) $this->publishIfCommitted();
    }

    private function publishIfCommitted(): void
    {
        if ($this->connection?->isTransactionActive()) return;
        $this->cache->invalidate($this->tags);
        $this->reset();
    }

    public function reset(): void
    {
        $this->tags = [];
        $this->connection = null;
    }
}
