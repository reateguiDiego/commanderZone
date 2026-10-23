<?php

declare(strict_types=1);

// Security floor for CVE-2026-109618 and CVE-2026-109619.
// Keep this emergency update within the application's tested PHP 8.4 branch.
function requirePatchedPhp(string $version, string $runtime): void
{
    if (!preg_match('/^8\.4\.[0-9]+$/D', $version) || version_compare($version, '8.4.27', '<')) {
        fwrite(STDERR, sprintf("%s reports PHP %s; stable PHP 8.4.27 or a later 8.4 patch is required.\n", $runtime, $version));
        exit(1);
    }
}

requirePatchedPhp(PHP_VERSION, 'CLI');
if (!PHP_ZTS) {
    fwrite(STDERR, "FrankenPHP requires the ZTS build.\n");
    exit(1);
}

$output = [];
$status = 0;
exec('frankenphp version 2>&1', $output, $status);
$description = implode("\n", $output);
if ($status !== 0 || !preg_match('/\bPHP ([^\s]+)/', $description, $matches)) {
    fwrite(STDERR, "Cannot verify the PHP version embedded in FrankenPHP.\n");
    exit(1);
}
requirePatchedPhp($matches[1], 'FrankenPHP');
if ($matches[1] !== PHP_VERSION) {
    fwrite(STDERR, "CLI and FrankenPHP PHP versions differ.\n");
    exit(1);
}

fwrite(STDOUT, sprintf("PHP security baseline verified: %s (ZTS), CLI and FrankenPHP.\n", PHP_VERSION));
