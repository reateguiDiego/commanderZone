<?php

use App\Kernel;

// Monotonic start of PHP execution, before Composer and Symfony bootstrap.
// Symfony Runtime includes this file a second time after loading Composer.
$_SERVER['CZ_PHP_ENTRY_NS'] ??= hrtime(true);

require_once dirname(__DIR__).'/vendor/autoload_runtime.php';

return static function (array $context) {
    return new Kernel($context['APP_ENV'], (bool) $context['APP_DEBUG']);
};
