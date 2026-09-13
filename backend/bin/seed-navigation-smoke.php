<?php

use App\Domain\Deck\Deck;
use App\Domain\User\User;
use App\Kernel;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\Dotenv\Dotenv;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

require dirname(__DIR__).'/vendor/autoload.php';
(new Dotenv())->bootEnv(dirname(__DIR__).'/.env');
if (($_SERVER['APP_ENV'] ?? $_ENV['APP_ENV'] ?? '') !== 'test') throw new RuntimeException('This fixture is restricted to APP_ENV=test.');
$password = getenv('USER_PASSWORD');
if (!$password) throw new RuntimeException('USER_PASSWORD is required.');
$kernel = new Kernel('test', false);
$kernel->boot();
$container = $kernel->getContainer()->get('test.service_container');
$em = $container->get(EntityManagerInterface::class);
$database = $em->getConnection()->fetchOne('SELECT current_database()');
if (!preg_match('/_test(?:_|$)/', $database)) throw new RuntimeException('Refusing to seed a non-test database.');
$hasher = $container->get(UserPasswordHasherInterface::class);
for ($i = 1; $i <= 5; ++$i) {
    $email = sprintf('test%02d@test.com', $i);
    $user = $em->getRepository(User::class)->findOneBy(['email' => $email]);
    if ($user === null) {
        $user = new User($email, sprintf('Smoke%02d', $i));
        $em->persist($user);
        $em->persist(new Deck($user, 'Navigation smoke'));
    }
    $user->setPassword($hasher->hashPassword($user, $password));
    $user->markEmailVerified();
}
$em->flush();
echo "Prepared five isolated navigation accounts.\n";
