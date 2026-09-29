<?php

namespace App\Tests\Integration;

use App\Domain\User\Role;
use App\UI\Console\E2eRoleGrantCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;

final class E2eRoleGrantCommandTest extends ApiTestCase
{
    public function testItGrantsAnAdminRoleOnlyThroughTheTestSetupCommand(): void
    {
        $email = 'e2e-role-grant@example.test';
        $this->registerAndLogin($email, 'E2E Role Grant');

        $tester = new CommandTester(static::getContainer()->get(E2eRoleGrantCommand::class));
        $status = $tester->execute(['--email' => $email, '--role' => Role::ADMIN]);

        self::assertSame(Command::SUCCESS, $status);
        self::assertStringContainsString('Granted '.Role::ADMIN, $tester->getDisplay());
        self::assertContains(
            Role::ADMIN,
            $this->entityManager->getConnection()->fetchFirstColumn(<<<'SQL'
SELECT role_code
FROM app_user_role
INNER JOIN app_user ON app_user.id = app_user_role.user_id
WHERE app_user.email = :email
SQL, ['email' => $email]),
        );
    }

    public function testItRefusesToRunOutsideDevelopmentAndTest(): void
    {
        $command = new E2eRoleGrantCommand($this->entityManager, 'staging');
        $tester = new CommandTester($command);

        self::assertSame(Command::FAILURE, $tester->execute([
            '--email' => 'not-used@example.test',
            '--role' => Role::ADMIN,
        ]));
        self::assertStringContainsString('only in dev or test', $tester->getDisplay());
    }
}
