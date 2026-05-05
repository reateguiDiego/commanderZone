<?php

use Symfony\Component\Dotenv\Dotenv;

require dirname(__DIR__).'/vendor/autoload.php';

// Tests must always boot the Symfony test environment.
$forceTestEnv = static function (): void {
    $_SERVER['APP_ENV'] = 'test';
    $_ENV['APP_ENV'] = 'test';
    putenv('APP_ENV=test');
};

$forceTestEnv();

if (!isset($_SERVER['APP_DEBUG']) || $_SERVER['APP_DEBUG'] === '' || $_SERVER['APP_DEBUG'] === false) {
    $_SERVER['APP_DEBUG'] = '1';
    $_ENV['APP_DEBUG'] = '1';
    putenv('APP_DEBUG=1');
}

if (method_exists(Dotenv::class, 'bootEnv')) {
    (new Dotenv())->bootEnv(dirname(__DIR__).'/.env');
}

// Ensure APP_ENV is still test even when container-level APP_ENV=dev exists.
$forceTestEnv();

if ($_SERVER['APP_DEBUG']) {
    umask(0000);
}
