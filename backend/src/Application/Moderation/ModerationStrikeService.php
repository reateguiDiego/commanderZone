<?php

declare(strict_types=1);

namespace App\Application\Moderation;

use App\Domain\Report\UserStrike;
use App\Domain\User\User;
use Doctrine\DBAL\LockMode;
use Doctrine\ORM\EntityManagerInterface;

class ModerationStrikeService
{
    public function __construct(
        private readonly EntityManagerInterface $entityManager,
        private readonly ModerationPermissionPolicy $permissions,
    ) {
    }

    public function issue(User $actor, User $target, string $description): UserStrike
    {
        if (mb_strlen(trim($description)) > 2000) {
            throw new ModerationValidationException('Strike description cannot exceed 2000 characters.');
        }

        $this->entityManager->beginTransaction();
        try {
            $this->entityManager->lock($target, LockMode::PESSIMISTIC_WRITE);
            $this->entityManager->refresh($target);
            $this->entityManager->refresh($actor);
            if (!$this->permissions->canReviewTarget($actor, $target)) {
                throw new ModerationValidationException('You cannot issue a strike to this user.');
            }
            $strike = new UserStrike($target, $actor, $description);
            $target->addStrike();
            $this->entityManager->persist($strike);
            $this->entityManager->flush();
            $this->entityManager->commit();

            return $strike;
        } catch (\Throwable $exception) {
            $this->rollback();

            throw $exception;
        }
    }

    public function delete(User $actor, User $target, string $strikeId): UserStrike
    {
        $this->entityManager->beginTransaction();
        try {
            $this->entityManager->lock($target, LockMode::PESSIMISTIC_WRITE);
            $this->entityManager->refresh($target);
            $this->entityManager->refresh($actor);
            if (!$this->permissions->canReviewTarget($actor, $target)) {
                throw new ModerationValidationException('You cannot remove a strike from this user.');
            }
            $strike = $this->entityManager->find(UserStrike::class, $strikeId, LockMode::PESSIMISTIC_WRITE);
            if (!$strike instanceof UserStrike || $strike->user()->id() !== $target->id()) {
                throw new ModerationNotFoundException('Strike not found.');
            }
            $target->removeStrike();
            $this->entityManager->remove($strike);
            $this->entityManager->flush();
            $this->entityManager->commit();

            return $strike;
        } catch (\Throwable $exception) {
            $this->rollback();

            throw $exception;
        }
    }

    /** @return list<UserStrike> */
    public function strikesFor(User $target): array
    {
        $strikes = $this->entityManager->getRepository(UserStrike::class)->createQueryBuilder('strike')
            ->leftJoin('strike.issuedBy', 'issuedBy')
            ->addSelect('issuedBy')
            ->where('strike.user = :user')
            ->setParameter('user', $target)
            ->orderBy('strike.createdAt', 'DESC')
            ->getQuery()
            ->getResult();

        return array_values(array_filter($strikes, static fn (mixed $strike): bool => $strike instanceof UserStrike));
    }

    private function rollback(): void
    {
        if ($this->entityManager->getConnection()->isTransactionActive()) {
            $this->entityManager->rollback();
        }
    }
}
