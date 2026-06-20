<?php

namespace App\Application\Game\Performance;

interface GameplayMetricsRecorderInterface
{
    /**
     * @param array<string,mixed> $metric
     */
    public function record(array $metric): void;
}
