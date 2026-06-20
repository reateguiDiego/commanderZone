<?php

namespace App\Application\Game\Performance;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

final class GameplayMetricsStore implements GameplayMetricsRecorderInterface
{
    /**
     * @var list<array<string,mixed>>
     */
    private array $records = [];

    private ?string $outputPath;

    public function __construct(
        #[Autowire('%gameplay_metrics_output%')]
        string $defaultOutputPath = '',
    ) {
        $this->outputPath = $this->normalizedOutputPath($defaultOutputPath);
    }

    /**
     * @param array<string,mixed> $metric
     */
    public function record(array $metric): void
    {
        $metric['recordedAt'] ??= (new \DateTimeImmutable())->format(DATE_ATOM);
        $this->records[] = $metric;

        if ($this->outputPath === null) {
            return;
        }

        $directory = dirname($this->outputPath);
        if (!is_dir($directory)) {
            @mkdir($directory, 0777, true);
        }

        file_put_contents(
            $this->outputPath,
            json_encode($metric, JSON_THROW_ON_ERROR).PHP_EOL,
            FILE_APPEND | LOCK_EX,
        );
    }

    public function reset(): void
    {
        $this->records = [];
    }

    /**
     * @return list<array<string,mixed>>
     */
    public function records(): array
    {
        return $this->records;
    }

    public function configureOutput(?string $outputPath, bool $truncate = false): void
    {
        $this->outputPath = $this->normalizedOutputPath($outputPath);
        if ($truncate && $this->outputPath !== null) {
            $directory = dirname($this->outputPath);
            if (!is_dir($directory)) {
                @mkdir($directory, 0777, true);
            }
            file_put_contents($this->outputPath, '');
        }
    }

    private function normalizedOutputPath(?string $outputPath): ?string
    {
        if (!is_string($outputPath)) {
            return null;
        }

        $trimmed = trim($outputPath);

        return $trimmed === '' ? null : $trimmed;
    }
}
