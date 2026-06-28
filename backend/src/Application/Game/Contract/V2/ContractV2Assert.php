<?php

namespace App\Application\Game\Contract\V2;

final class ContractV2Assert
{
    /**
     * @param array<string,mixed> $data
     */
    public static function requiredNonEmptyString(array $data, string $field): string
    {
        $value = $data[$field] ?? null;
        if (!is_string($value) || trim($value) === '') {
            throw new \InvalidArgumentException(sprintf('Field "%s" must be a non-empty string.', $field));
        }

        return trim($value);
    }

    /**
     * @param array<string,mixed> $data
     */
    public static function optionalNonEmptyString(array $data, string $field): ?string
    {
        $value = $data[$field] ?? null;
        if ($value === null) {
            return null;
        }
        if (!is_string($value) || trim($value) === '') {
            throw new \InvalidArgumentException(sprintf('Field "%s" must be a non-empty string when provided.', $field));
        }

        return trim($value);
    }

    /**
     * @param array<string,mixed> $data
     */
    public static function requiredPositiveInt(array $data, string $field): int
    {
        $value = $data[$field] ?? null;
        if (!is_int($value) || $value < 1) {
            throw new \InvalidArgumentException(sprintf('Field "%s" must be an integer greater than or equal to 1.', $field));
        }

        return $value;
    }

    /**
     * @param array<string,mixed> $data
     * @return array<string,mixed>
     */
    public static function requiredMap(array $data, string $field): array
    {
        $value = $data[$field] ?? null;
        if (!is_array($value) || ($value !== [] && array_is_list($value))) {
            throw new \InvalidArgumentException(sprintf('Field "%s" must be an object.', $field));
        }

        return $value;
    }

    /**
     * @param array<string,mixed> $data
     * @return list<mixed>
     */
    public static function requiredList(array $data, string $field): array
    {
        $value = $data[$field] ?? null;
        if (!is_array($value) || !array_is_list($value)) {
            throw new \InvalidArgumentException(sprintf('Field "%s" must be a list.', $field));
        }

        return $value;
    }

    /**
     * @param array<string,mixed> $data
     * @return array<string,mixed>|null
     */
    public static function optionalMap(array $data, string $field): ?array
    {
        $value = $data[$field] ?? null;
        if ($value === null) {
            return null;
        }
        if (!is_array($value) || ($value !== [] && array_is_list($value))) {
            throw new \InvalidArgumentException(sprintf('Field "%s" must be an object when provided.', $field));
        }

        return $value;
    }

    public static function optionalDateTimeString(?string $value, string $field): ?string
    {
        if ($value === null) {
            return null;
        }

        try {
            new \DateTimeImmutable($value);
        } catch (\Throwable) {
            throw new \InvalidArgumentException(sprintf('Field "%s" must be a valid ISO-8601 date-time string.', $field));
        }

        return $value;
    }

    /**
     * @param list<mixed> $ops
     * @return list<array<string,mixed>>
     */
    public static function semanticOps(array $ops): array
    {
        $normalized = [];
        foreach ($ops as $index => $op) {
            if (!is_array($op) || array_is_list($op)) {
                throw new \InvalidArgumentException(sprintf('Patch op at index %d must be an object.', $index));
            }
            $name = $op['op'] ?? null;
            if (!is_string($name) || trim($name) === '') {
                throw new \InvalidArgumentException(sprintf('Patch op at index %d must include a non-empty "op" string.', $index));
            }

            $normalized[] = $op;
        }

        return $normalized;
    }

    public static function visibility(string $value): string
    {
        if (preg_match('/^(public|player:[^:]+|group:[A-Za-z0-9_-]+)$/', $value) !== 1) {
            throw new \InvalidArgumentException('Field "visibility" must be "public", "player:<id>", or "group:<mask>".');
        }

        return $value;
    }
}
