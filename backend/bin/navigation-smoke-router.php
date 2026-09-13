<?php

// Explicitly propagate the test environment for CLI-server SAPIs that omit it
// from $_SERVER. Never expose this development router as a production entrypoint.
if (getenv('APP_ENV') !== 'test') {
    http_response_code(503);
    exit('Navigation smoke requires APP_ENV=test.');
}
foreach (['APP_ENV' => 'test', 'APP_DEBUG' => '0', 'TEST_TOKEN' => getenv('TEST_TOKEN') ?: ''] as $key => $value) {
    $_SERVER[$key] = $_ENV[$key] = $value;
    putenv($key.'='.$value);
}
require dirname(__DIR__).'/public/index.php';
