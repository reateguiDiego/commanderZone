<?php

namespace App\Application\User;

final readonly class AdminUserLocalizationSummaryFactory
{
    public function __construct(private CountryContinentResolver $continents)
    {
    }

    /**
     * @param list<array{countryCode:string|null, countryName:string|null, appLanguage:string, isActive:bool}> $users
     * @return array{
     *   all: array{totalUsers:int, countries:list<array{code:string|null, name:string|null, userCount:int, share:int}>, continents:list<array{code:string|null, name:string|null, userCount:int, share:int}>, languages:list<array{code:string|null, name:string|null, userCount:int, share:int}>},
     *   active: array{totalUsers:int, countries:list<array{code:string|null, name:string|null, userCount:int, share:int}>, continents:list<array{code:string|null, name:string|null, userCount:int, share:int}>, languages:list<array{code:string|null, name:string|null, userCount:int, share:int}>}
     * }
     */
    public function create(array $users): array
    {
        $activeUsers = array_values(array_filter($users, static fn (array $user): bool => $user['isActive']));

        return [
            'all' => $this->breakdown($users),
            'active' => $this->breakdown($activeUsers),
        ];
    }

    /**
     * @param list<array{countryCode:string|null, countryName:string|null, appLanguage:string, isActive:bool}> $users
     * @return array{totalUsers:int, countries:list<array{code:string|null, name:string|null, userCount:int, share:int}>, continents:list<array{code:string|null, name:string|null, userCount:int, share:int}>, languages:list<array{code:string|null, name:string|null, userCount:int, share:int}>}
     */
    private function breakdown(array $users): array
    {
        $countries = [];
        $continents = [];
        $languages = [];

        foreach ($users as $user) {
            $countryCode = $this->normalizedCountryCode($user['countryCode']);
            $countryName = $this->normalizedName($user['countryName']);
            $this->increment($countries, $countryCode, $countryName);

            $continent = $this->continents->resolve($countryCode);
            $this->increment($continents, $continent['code'] ?? null, $continent['name'] ?? null);

            $languageCode = $this->normalizedLanguageCode($user['appLanguage']);
            $this->increment($languages, $languageCode, $languageCode);
        }

        $totalUsers = count($users);

        return [
            'totalUsers' => $totalUsers,
            'countries' => $this->summarize($countries, $totalUsers),
            'continents' => $this->summarize($continents, $totalUsers),
            'languages' => $this->summarize($languages, $totalUsers),
        ];
    }

    /** @param array<string, array{code:string|null, name:string|null, userCount:int}> $groups */
    private function increment(array &$groups, ?string $code, ?string $name): void
    {
        $key = $code ?? 'unknown';
        if (!isset($groups[$key])) {
            $groups[$key] = ['code' => $code, 'name' => $name, 'userCount' => 0];
        }

        $groups[$key]['userCount']++;
        if ($groups[$key]['name'] === null && $name !== null) {
            $groups[$key]['name'] = $name;
        }
    }

    /**
     * @param array<string, array{code:string|null, name:string|null, userCount:int}> $groups
     * @return list<array{code:string|null, name:string|null, userCount:int, share:int}>
     */
    private function summarize(array $groups, int $totalUsers): array
    {
        $summary = array_map(
            static fn (array $group): array => [
                ...$group,
                'share' => $totalUsers === 0 ? 0 : (int) round(($group['userCount'] / $totalUsers) * 100),
            ],
            array_values($groups),
        );

        usort($summary, static fn (array $left, array $right): int => ($right['userCount'] <=> $left['userCount'])
            ?: strcasecmp((string) $left['name'], (string) $right['name']));

        return $summary;
    }

    private function normalizedCountryCode(?string $code): ?string
    {
        if (!is_string($code)) {
            return null;
        }

        $normalizedCode = strtoupper(trim($code));

        return $normalizedCode === '' ? null : $normalizedCode;
    }

    private function normalizedLanguageCode(?string $code): ?string
    {
        if (!is_string($code)) {
            return null;
        }

        $normalizedCode = strtolower(trim($code));

        return $normalizedCode === '' ? null : $normalizedCode;
    }

    private function normalizedName(?string $name): ?string
    {
        if (!is_string($name)) {
            return null;
        }

        $normalizedName = trim($name);

        return $normalizedName === '' ? null : $normalizedName;
    }
}
