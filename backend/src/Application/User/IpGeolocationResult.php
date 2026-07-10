<?php

namespace App\Application\User;

final class IpGeolocationResult
{
    private ?string $countryCode;
    private ?string $countryName;
    private ?string $continentCode;
    private ?string $source;

    public function __construct(
        ?string $countryCode = null,
        ?string $countryName = null,
        ?string $continentCode = null,
        ?string $source = null,
    ) {
        $this->countryCode = $this->normalizeCode($countryCode, 2);
        $this->countryName = $this->normalizeText($countryName);
        $this->continentCode = $this->normalizeCode($continentCode, 8);
        $this->source = $this->normalizeText($source);
    }

    public static function unresolved(?string $source = null): self
    {
        return new self(source: $source);
    }

    public function countryCode(): ?string
    {
        return $this->countryCode;
    }

    public function countryName(): ?string
    {
        return $this->countryName;
    }

    public function continentCode(): ?string
    {
        return $this->continentCode;
    }

    public function source(): ?string
    {
        return $this->source;
    }

    private function normalizeCode(?string $value, int $maxLength): ?string
    {
        $normalized = strtoupper(trim((string) $value));
        if ($normalized === '') {
            return null;
        }

        return substr($normalized, 0, $maxLength);
    }

    private function normalizeText(?string $value): ?string
    {
        $normalized = trim((string) $value);

        return $normalized !== '' ? $normalized : null;
    }
}
