<?php

namespace App\Application\Auth;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Contracts\HttpClient\HttpClientInterface;

class GoogleIdTokenVerifier implements GoogleIdTokenVerifierInterface
{
    private const ALLOWED_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

    public function __construct(
        private readonly HttpClientInterface $httpClient,
        #[Autowire('%google_oidc_client_ids%')]
        private readonly string $clientIds,
        #[Autowire('%google_oidc_jwks_uri%')]
        private readonly string $jwksUri,
    ) {
    }

    public function verify(string $idToken): GoogleIdTokenClaims
    {
        $token = trim($idToken);
        if ($token === '') {
            throw new InvalidGoogleIdToken('Google credential is required.');
        }

        $allowedAudiences = $this->allowedAudiences();
        if ($allowedAudiences === []) {
            throw new GoogleOidcNotConfigured('Google login is not configured.');
        }

        [$header, $payload, $signature, $signedContent] = $this->decodeToken($token);
        $this->verifySignature($header, $signature, $signedContent);
        $this->verifyClaims($payload, $allowedAudiences);

        return new GoogleIdTokenClaims(
            (string) $payload['sub'],
            mb_strtolower((string) $payload['email']),
            true,
            isset($payload['name']) && is_string($payload['name']) ? trim($payload['name']) : null,
        );
    }

    /**
     * @return list<string>
     */
    private function allowedAudiences(): array
    {
        return array_values(array_filter(
            array_map('trim', explode(',', $this->clientIds)),
            static fn (string $clientId): bool => $clientId !== '',
        ));
    }

    /**
     * @return array{0: array<string,mixed>, 1: array<string,mixed>, 2: string, 3: string}
     */
    private function decodeToken(string $token): array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            throw new InvalidGoogleIdToken('Google credential is invalid.');
        }

        [$encodedHeader, $encodedPayload, $encodedSignature] = $parts;
        $header = json_decode($this->base64UrlDecode($encodedHeader), true);
        $payload = json_decode($this->base64UrlDecode($encodedPayload), true);

        if (!is_array($header) || !is_array($payload)) {
            throw new InvalidGoogleIdToken('Google credential is invalid.');
        }

        return [
            $header,
            $payload,
            $this->base64UrlDecode($encodedSignature),
            $encodedHeader.'.'.$encodedPayload,
        ];
    }

    /**
     * @param array<string,mixed> $header
     */
    private function verifySignature(array $header, string $signature, string $signedContent): void
    {
        if (($header['alg'] ?? null) !== 'RS256' || !isset($header['kid']) || !is_string($header['kid'])) {
            throw new InvalidGoogleIdToken('Google credential signature is invalid.');
        }

        $key = $this->jwkForKeyId($header['kid']);
        $publicKey = $this->rsaPublicKeyPem((string) $key['n'], (string) $key['e']);
        $verified = openssl_verify($signedContent, $signature, $publicKey, OPENSSL_ALGO_SHA256);
        if ($verified !== 1) {
            throw new InvalidGoogleIdToken('Google credential signature is invalid.');
        }
    }

    /**
     * @return array<string,mixed>
     */
    private function jwkForKeyId(string $keyId): array
    {
        $response = $this->httpClient->request('GET', $this->jwksUri);
        $jwks = $response->toArray(false);
        $keys = $jwks['keys'] ?? null;
        if (!is_array($keys)) {
            throw new InvalidGoogleIdToken('Google public keys could not be loaded.');
        }

        foreach ($keys as $key) {
            if (
                is_array($key)
                && ($key['kid'] ?? null) === $keyId
                && ($key['kty'] ?? null) === 'RSA'
                && isset($key['n'], $key['e'])
                && is_string($key['n'])
                && is_string($key['e'])
            ) {
                return $key;
            }
        }

        throw new InvalidGoogleIdToken('Google credential key is unknown.');
    }

    /**
     * @param array<string,mixed> $payload
     * @param list<string> $allowedAudiences
     */
    private function verifyClaims(array $payload, array $allowedAudiences): void
    {
        if (!isset($payload['iss']) || !is_string($payload['iss']) || !in_array($payload['iss'], self::ALLOWED_ISSUERS, true)) {
            throw new InvalidGoogleIdToken('Google credential issuer is invalid.');
        }

        $audience = $payload['aud'] ?? null;
        if (!is_string($audience) || !in_array($audience, $allowedAudiences, true)) {
            throw new InvalidGoogleIdToken('Google credential audience is invalid.');
        }

        if (!isset($payload['exp']) || !is_int($payload['exp']) || $payload['exp'] <= time()) {
            throw new InvalidGoogleIdToken('Google credential has expired.');
        }

        if (!isset($payload['sub']) || !is_string($payload['sub']) || trim($payload['sub']) === '') {
            throw new InvalidGoogleIdToken('Google credential subject is invalid.');
        }

        if (!isset($payload['email']) || !is_string($payload['email']) || filter_var($payload['email'], FILTER_VALIDATE_EMAIL) === false) {
            throw new InvalidGoogleIdToken('Google credential email is invalid.');
        }

        if (($payload['email_verified'] ?? null) !== true) {
            throw new InvalidGoogleIdToken('Google email verification is required.');
        }
    }

    private function base64UrlDecode(string $encoded): string
    {
        $remainder = strlen($encoded) % 4;
        if ($remainder !== 0) {
            $encoded .= str_repeat('=', 4 - $remainder);
        }

        $decoded = base64_decode(strtr($encoded, '-_', '+/'), true);
        if ($decoded === false) {
            throw new InvalidGoogleIdToken('Google credential is invalid.');
        }

        return $decoded;
    }

    private function rsaPublicKeyPem(string $modulus, string $exponent): string
    {
        $rsaPublicKey = $this->asn1Sequence(
            $this->asn1Integer($this->base64UrlDecode($modulus)).
            $this->asn1Integer($this->base64UrlDecode($exponent)),
        );
        $algorithmIdentifier = hex2bin('300d06092a864886f70d0101010500');
        if ($algorithmIdentifier === false) {
            throw new \LogicException('Invalid RSA algorithm identifier.');
        }

        $subjectPublicKeyInfo = $this->asn1Sequence($algorithmIdentifier.$this->asn1BitString($rsaPublicKey));

        return "-----BEGIN PUBLIC KEY-----\n"
            .chunk_split(base64_encode($subjectPublicKeyInfo), 64, "\n")
            ."-----END PUBLIC KEY-----\n";
    }

    private function asn1Sequence(string $value): string
    {
        return "\x30".$this->asn1Length(strlen($value)).$value;
    }

    private function asn1Integer(string $value): string
    {
        $normalized = ltrim($value, "\x00");
        if ($normalized === '') {
            $normalized = "\x00";
        }
        if ((ord($normalized[0]) & 0x80) !== 0) {
            $normalized = "\x00".$normalized;
        }

        return "\x02".$this->asn1Length(strlen($normalized)).$normalized;
    }

    private function asn1BitString(string $value): string
    {
        $prefixed = "\x00".$value;

        return "\x03".$this->asn1Length(strlen($prefixed)).$prefixed;
    }

    private function asn1Length(int $length): string
    {
        if ($length < 128) {
            return chr($length);
        }

        $encoded = '';
        while ($length > 0) {
            $encoded = chr($length & 0xff).$encoded;
            $length >>= 8;
        }

        return chr(0x80 | strlen($encoded)).$encoded;
    }
}
