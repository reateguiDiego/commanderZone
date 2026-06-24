<?php

$body = @file_get_contents('http://127.0.0.1:8081/healthz');
exit($body === 'ok' ? 0 : 1);
