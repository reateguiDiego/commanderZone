<?php

namespace App\Tests\Integration;

use App\UI\Console\CommunityPreviewExplainCommand;
use Symfony\Component\Console\Tester\CommandTester;

final class CommunityPreviewExplainCommandTest extends ApiTestCase
{
    public function testDiagnosticsUseTheRealQueriesAndLeaveNoTransactionOrDataChanges(): void
    {
        $this->seedCard('58000000-0000-0000-0000-000000000001', 'Diagnostic Commander', ['type_line' => 'Legendary Creature - Wizard']);
        $connection = $this->entityManager->getConnection();
        $tester = new CommandTester(new CommunityPreviewExplainCommand($connection));
        foreach ([[], ['--analyze' => true]] as $options) {
            self::assertSame(0, $tester->execute($options));
            $result = json_decode($tester->getDisplay(), true, 512, JSON_THROW_ON_ERROR);
            self::assertSame(isset($options['--analyze']), $result['analyze']);
            self::assertSame(['cards', 'commanders'], array_keys($result['plans']));
            self::assertArrayHasKey('Plan', $result['plans']['cards'][0]);
            self::assertSame(isset($options['--analyze']), isset($result['plans']['cards'][0]['Execution Time']));
            self::assertFalse($connection->isTransactionActive());
            self::assertSame(1, (int) $connection->fetchOne('SELECT COUNT(*) FROM card'));
        }
    }
}
