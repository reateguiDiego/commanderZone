<?php

namespace App\UI\Console;

use App\Domain\User\Role;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

/**
 * Local-browser E2E setup only. It is deliberately a CLI command instead of
 * an HTTP backdoor and refuses production unconditionally.
 */
#[AsCommand(name: 'app:e2e:grant-role', description: 'Grant an authorization role to an E2E user.')]
final class E2eRoleGrantCommand extends Command
{
    public function __construct(
        private readonly EntityManagerInterface $entityManager,
        #[Autowire('%kernel.environment%')]
        private readonly string $environment,
    ) {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addOption('email', null, InputOption::VALUE_REQUIRED, 'Registered E2E user email.')
            ->addOption('role', null, InputOption::VALUE_REQUIRED, 'Role code to grant.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        if (!in_array($this->environment, ['dev', 'test'], true)) {
            $output->writeln('<error>This command is available only in dev or test environments.</error>');

            return Command::FAILURE;
        }

        $email = mb_strtolower(trim((string) $input->getOption('email')));
        $roleCode = trim((string) $input->getOption('role'));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !Role::isSupported($roleCode)) {
            $output->writeln('<error>A valid --email and supported --role are required.</error>');

            return Command::INVALID;
        }

        $user = $this->entityManager->getRepository(User::class)->findOneBy(['email' => $email]);
        if (!$user instanceof User) {
            $output->writeln('<error>E2E user was not found.</error>');

            return Command::FAILURE;
        }
        $role = $this->entityManager->getRepository(Role::class)->find($roleCode);
        if (!$role instanceof Role) {
            $output->writeln('<error>The requested role is not configured.</error>');

            return Command::FAILURE;
        }

        if ($roleCode === Role::OWNER && $this->otherOwnerExists($user->id())) {
            $output->writeln('<error>An owner already exists; E2E role grant will not replace it.</error>');

            return Command::FAILURE;
        }

        $user->grantRole($role);
        $this->entityManager->flush();
        $output->writeln(sprintf('Granted %s to E2E user %s.', $roleCode, $email));

        return Command::SUCCESS;
    }

    private function otherOwnerExists(string $userId): bool
    {
        return (bool) $this->entityManager->getConnection()->fetchOne(<<<'SQL'
SELECT 1
FROM app_user_role
WHERE role_code = :roleCode
  AND user_id <> :userId
LIMIT 1
SQL, ['roleCode' => Role::OWNER, 'userId' => $userId]);
    }
}
