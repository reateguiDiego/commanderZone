<?php

namespace App\Application\User;

final class CountryContinentResolver
{
    /**
     * ISO 3166-1 alpha-2 country codes grouped by continent.
     *
     * @var array<string, array{name:string, countryCodes:list<string>}>
     */
    private const CONTINENTS = [
        'AF' => [
            'name' => 'Africa',
            'countryCodes' => ['DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CV', 'CM', 'CF', 'TD', 'KM', 'CD', 'CG', 'CI', 'DJ', 'EG', 'GQ', 'ER', 'SZ', 'ET', 'GA', 'GM', 'GH', 'GN', 'GW', 'KE', 'LS', 'LR', 'LY', 'MG', 'MW', 'ML', 'MR', 'MU', 'YT', 'MA', 'MZ', 'NA', 'NE', 'NG', 'RE', 'RW', 'SH', 'ST', 'SN', 'SC', 'SL', 'SO', 'ZA', 'SS', 'SD', 'TZ', 'TG', 'TN', 'UG', 'EH', 'ZM', 'ZW'],
        ],
        'AN' => [
            'name' => 'Antarctica',
            'countryCodes' => ['AQ', 'BV', 'TF', 'HM', 'GS'],
        ],
        'AS' => [
            'name' => 'Asia',
            'countryCodes' => ['AF', 'AM', 'AZ', 'BH', 'BD', 'BT', 'BN', 'KH', 'CN', 'CX', 'CC', 'CY', 'GE', 'HK', 'IN', 'ID', 'IR', 'IQ', 'IL', 'JP', 'JO', 'KZ', 'KP', 'KR', 'KW', 'KG', 'LA', 'LB', 'MO', 'MY', 'MV', 'MN', 'MM', 'NP', 'OM', 'PK', 'PS', 'PH', 'QA', 'SA', 'SG', 'LK', 'SY', 'TW', 'TJ', 'TH', 'TL', 'TR', 'TM', 'AE', 'UZ', 'VN', 'YE', 'IO'],
        ],
        'EU' => [
            'name' => 'Europe',
            'countryCodes' => ['AX', 'AL', 'AD', 'AT', 'BY', 'BE', 'BA', 'BG', 'HR', 'CZ', 'DK', 'EE', 'FO', 'FI', 'FR', 'DE', 'GI', 'GR', 'GG', 'VA', 'HU', 'IS', 'IE', 'IM', 'IT', 'JE', 'LV', 'LI', 'LT', 'LU', 'MT', 'MD', 'MC', 'ME', 'NL', 'MK', 'NO', 'PL', 'PT', 'RO', 'RU', 'SM', 'RS', 'SK', 'SI', 'ES', 'SJ', 'SE', 'CH', 'UA', 'GB', 'UK', 'XK'],
        ],
        'NA' => [
            'name' => 'North America',
            'countryCodes' => ['AI', 'AG', 'AW', 'BS', 'BB', 'BZ', 'BM', 'BQ', 'CA', 'KY', 'CR', 'CU', 'CW', 'DM', 'DO', 'SV', 'GL', 'GD', 'GP', 'GT', 'HT', 'HN', 'JM', 'MQ', 'MX', 'MS', 'NI', 'PA', 'PR', 'BL', 'KN', 'LC', 'MF', 'PM', 'VC', 'SX', 'TT', 'TC', 'US', 'VG', 'VI'],
        ],
        'OC' => [
            'name' => 'Oceania',
            'countryCodes' => ['AS', 'AU', 'CK', 'FJ', 'PF', 'GU', 'KI', 'MH', 'FM', 'NR', 'NC', 'NZ', 'NU', 'NF', 'MP', 'PW', 'PG', 'PN', 'WS', 'SB', 'TK', 'TO', 'TV', 'UM', 'VU', 'WF'],
        ],
        'SA' => [
            'name' => 'South America',
            'countryCodes' => ['AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'FK', 'GF', 'GY', 'PY', 'PE', 'SR', 'UY', 'VE'],
        ],
    ];

    /** @return array{code:string, name:string}|null */
    public function resolve(?string $countryCode): ?array
    {
        if (!is_string($countryCode)) {
            return null;
        }

        $normalizedCountryCode = strtoupper(trim($countryCode));
        if (preg_match('/^[A-Z]{2}$/', $normalizedCountryCode) !== 1) {
            return null;
        }

        foreach (self::CONTINENTS as $continentCode => $continent) {
            if (in_array($normalizedCountryCode, $continent['countryCodes'], true)) {
                return ['code' => $continentCode, 'name' => $continent['name']];
            }
        }

        return null;
    }
}
