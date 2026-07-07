<?php

namespace App\Application\Deck;

final class CardSemanticManualConfig
{
    /**
     * @param array<string,array<string,bool>> $powerFlagsByName
     * @param array<string,array<string,bool>> $conditionNames
     * @param array<string,array<string,bool>> $qualityNames
     */
    public function __construct(
        private readonly array $powerFlagsByName = [],
        private readonly array $conditionNames = [],
        private readonly array $qualityNames = [],
    ) {
    }

    public static function load(?string $configDir = null): self
    {
        $dir = $configDir ?? dirname(__DIR__, 3).'/config/deck_analysis';

        return new self(
            self::loadNameBuckets($dir.'/manual_power_flags.php'),
            self::loadNameBuckets($dir.'/manual_conditions.php'),
            self::loadNameBuckets($dir.'/manual_role_quality.php'),
        );
    }

    public function hasPowerFlag(string $flag, ?string $name): bool
    {
        return $this->hasName($this->powerFlagsByName, $flag, $name);
    }

    /**
     * @return list<string>
     */
    public function conditionsForName(?string $name): array
    {
        return $this->keysForName($this->conditionNames, $name);
    }

    public function hasQualityName(string $bucket, ?string $name): bool
    {
        return $this->hasName($this->qualityNames, $bucket, $name);
    }

    /**
     * @return array<string,array<string,bool>>
     */
    private static function loadNameBuckets(string $path): array
    {
        if (!is_file($path)) {
            throw new \RuntimeException(sprintf('Deck analysis config file was not found: %s', $path));
        }

        $raw = require $path;
        if (!is_array($raw)) {
            throw new \RuntimeException(sprintf('Deck analysis config file must return an array: %s', $path));
        }

        $buckets = [];
        foreach ($raw as $bucket => $names) {
            if (!is_string($bucket) || !is_array($names)) {
                throw new \RuntimeException(sprintf('Invalid deck analysis config bucket in %s.', $path));
            }

            $buckets[$bucket] = [];
            foreach ($names as $name) {
                if (!is_scalar($name)) {
                    continue;
                }

                $normalizedName = self::normalizeName((string) $name);
                if ($normalizedName !== '') {
                    $buckets[$bucket][$normalizedName] = true;
                }
            }
        }

        return $buckets;
    }

    /**
     * @param array<string,array<string,bool>> $buckets
     */
    private function hasName(array $buckets, string $bucket, ?string $name): bool
    {
        $normalizedNames = self::candidateNames((string) $name);

        foreach ($normalizedNames as $normalizedName) {
            if (isset($buckets[$bucket][$normalizedName])) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string,array<string,bool>> $buckets
     * @return list<string>
     */
    private function keysForName(array $buckets, ?string $name): array
    {
        $normalizedNames = self::candidateNames((string) $name);
        if ($normalizedNames === []) {
            return [];
        }

        $keys = [];
        foreach ($buckets as $bucket => $names) {
            foreach ($normalizedNames as $normalizedName) {
                if (isset($names[$normalizedName])) {
                    $keys[] = $bucket;
                    break;
                }
            }
        }

        return $keys;
    }

    private static function normalizeName(string $name): string
    {
        return mb_strtolower(trim($name));
    }

    /**
     * @return list<string>
     */
    private static function candidateNames(string $name): array
    {
        $normalizedName = self::normalizeName($name);
        if ($normalizedName === '') {
            return [];
        }

        $candidates = [$normalizedName];
        $frontFace = trim(explode('//', $normalizedName, 2)[0]);
        if ($frontFace !== '' && $frontFace !== $normalizedName) {
            $candidates[] = $frontFace;
        }

        return array_values(array_unique($candidates));
    }
}
