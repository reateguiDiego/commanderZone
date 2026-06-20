<?php

namespace App\Application\Game\Performance;

final class GameplayNullMetricsRecorder implements GameplayMetricsRecorderInterface
{
    public function record(array $metric): void
    {
    }
}
