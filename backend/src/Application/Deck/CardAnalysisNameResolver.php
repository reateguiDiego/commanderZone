<?php

namespace App\Application\Deck;

use Doctrine\DBAL\Connection;

final class CardAnalysisNameResolver
{
    /**
     * @var array<string,array<string,array{name:string,oracle_id:string,commander_legal:bool}>>
     */
    private array $index = [];

    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * @return array{status:'resolved',oracle_id:string,name:string}|array{status:'missing'}|array{status:'ambiguous',candidates:list<array{name:string,oracle_id:string}>}
     */
    public function resolve(string $name): array
    {
        $this->ensureIndex();

        foreach ($this->lookupKeys($name) as $key) {
            $candidates = $this->index[$key] ?? [];
            if ($candidates === []) {
                continue;
            }

            $resolved = $this->resolveCandidates($candidates);
            if ($resolved !== null) {
                return [
                    'status' => 'resolved',
                    'oracle_id' => $resolved['oracle_id'],
                    'name' => $resolved['name'],
                ];
            }

            return [
                'status' => 'ambiguous',
                'candidates' => array_map(
                    static fn (array $candidate): array => [
                        'name' => $candidate['name'],
                        'oracle_id' => $candidate['oracle_id'],
                    ],
                    array_values($candidates),
                ),
            ];
        }

        return ['status' => 'missing'];
    }

    private function ensureIndex(): void
    {
        if ($this->index !== []) {
            return;
        }

        $rows = $this->connection->executeQuery(
            <<<'SQL'
SELECT
    profile.oracle_id,
    profile.name,
    profile.normalized_name,
    profile.commander_legal,
    oracle.layout,
    oracle.card_faces
FROM card_analysis_profile profile
LEFT JOIN card_oracle_profile oracle ON oracle.oracle_id = profile.oracle_id
ORDER BY profile.name ASC
SQL,
        )->iterateAssociative();

        foreach ($rows as $row) {
            if ($this->isIgnoredForDeckAnalysis($row)) {
                continue;
            }

            $candidate = [
                'name' => (string) $row['name'],
                'oracle_id' => (string) $row['oracle_id'],
                'commander_legal' => $this->boolValue($row['commander_legal'] ?? false),
            ];

            foreach ($this->candidateNames($row) as $candidateName) {
                foreach ($this->lookupKeys($candidateName) as $key) {
                    $this->index[$key][$candidate['oracle_id']] = $candidate;
                }
            }
        }
    }

    /**
     * @param array<string,mixed> $row
     * @return list<string>
     */
    private function candidateNames(array $row): array
    {
        $names = [
            (string) $row['name'],
            (string) $row['normalized_name'],
            $this->frontFace((string) $row['name']),
            $this->frontFace((string) $row['normalized_name']),
        ];

        foreach ($this->jsonArray($row['card_faces'] ?? []) as $face) {
            if (!is_array($face) || !is_scalar($face['name'] ?? null)) {
                continue;
            }

            $faceName = trim((string) $face['name']);
            if ($faceName !== '') {
                $names[] = $faceName;
                $names[] = $this->frontFace($faceName);
            }
        }

        foreach ($names as $name) {
            $withoutArticle = $this->withoutLeadingArticle($name);
            if ($withoutArticle !== $name) {
                $names[] = $withoutArticle;
            }
        }

        return array_values(array_unique(array_filter($names, static fn (string $name): bool => trim($name) !== '')));
    }

    /**
     * @return list<string>
     */
    private function lookupKeys(string $name): array
    {
        $trimmed = trim($name);
        $frontFace = $this->frontFace($trimmed);

        return array_values(array_unique(array_filter([
            'exact:'.mb_strtolower($trimmed),
            'exact:'.mb_strtolower($frontFace),
            'exact:'.mb_strtolower($this->withoutLeadingArticle($trimmed)),
            'exact:'.mb_strtolower($this->withoutLeadingArticle($frontFace)),
            'safe:'.$this->safeName($trimmed),
            'safe:'.$this->safeName($frontFace),
            'safe:'.$this->safeName($this->withoutLeadingArticle($trimmed)),
            'safe:'.$this->safeName($this->withoutLeadingArticle($frontFace)),
        ], static fn (string $key): bool => !str_ends_with($key, ':'))));
    }

    /**
     * @param array<string,array{name:string,oracle_id:string,commander_legal:bool}> $candidates
     * @return array{name:string,oracle_id:string,commander_legal:bool}|null
     */
    private function resolveCandidates(array $candidates): ?array
    {
        if (count($candidates) === 1) {
            return reset($candidates);
        }

        $legal = array_values(array_filter($candidates, static fn (array $candidate): bool => $candidate['commander_legal']));
        if (count($legal) === 1) {
            return $legal[0];
        }

        return null;
    }

    private function frontFace(string $name): string
    {
        return trim(explode('//', $name, 2)[0]);
    }

    private function safeName(string $name): string
    {
        $normalized = class_exists(\Normalizer::class) ? \Normalizer::normalize($name, \Normalizer::FORM_D) : $name;
        if (!is_string($normalized)) {
            $normalized = $name;
        }

        $withoutMarks = preg_replace('/\p{Mn}+/u', '', $normalized) ?? $normalized;
        $withoutPunctuation = preg_replace('/[^\p{L}\p{N}]+/u', ' ', str_replace(["'", '’', '`', '´'], '', $withoutMarks)) ?? $withoutMarks;

        return trim(preg_replace('/\s+/', ' ', mb_strtolower($withoutPunctuation)) ?? $withoutPunctuation);
    }

    private function withoutLeadingArticle(string $name): string
    {
        return preg_replace('/^the\s+/i', '', trim($name)) ?? trim($name);
    }

    /**
     * @param array<string,mixed> $row
     */
    private function isIgnoredForDeckAnalysis(array $row): bool
    {
        if (!$this->boolValue($row['commander_legal'] ?? false)) {
            return true;
        }

        $name = trim((string) ($row['name'] ?? ''));
        $normalizedName = trim((string) ($row['normalized_name'] ?? ''));
        $layout = mb_strtolower(trim((string) ($row['layout'] ?? '')));

        return str_starts_with($name, 'A-')
            || str_starts_with($normalizedName, 'a-')
            || in_array($layout, ['alchemy', 'rebalanced', 'prepare'], true);
    }

    /**
     * @return list<mixed>
     */
    private function jsonArray(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }

        if (!is_string($value) || trim($value) === '') {
            return [];
        }

        $decoded = json_decode($value, true);

        return is_array($decoded) ? $decoded : [];
    }

    private function boolValue(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        if (is_int($value)) {
            return $value === 1;
        }

        if (!is_string($value)) {
            return false;
        }

        return in_array(mb_strtolower(trim($value)), ['1', 'true', 't', 'yes', 'y'], true);
    }
}
