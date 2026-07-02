<?php

namespace App\UI\Http;

use App\Application\Auth\AuthSessionResponseFactory;
use App\Application\Auth\GoogleOidcNotConfigured;
use App\Application\Auth\InvalidGoogleIdToken;
use App\Application\Auth\SocialAuthEmailLinkRequired;
use App\Application\Auth\SocialAuthService;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

class SocialAuthController extends ApiController
{
    public function __construct(
        private readonly SocialAuthService $socialAuthService,
        private readonly AuthSessionResponseFactory $sessionResponseFactory,
    ) {
    }

    #[Route('/auth/google/exchange', methods: ['POST'])]
    public function googleExchange(Request $request): JsonResponse
    {
        $payload = $this->payload($request);
        $credential = trim((string) ($payload['credential'] ?? ''));

        try {
            $user = $this->socialAuthService->authenticateWithGoogle($credential, $request->getClientIp());
        } catch (GoogleOidcNotConfigured) {
            return $this->fail('Google login is not configured.', 503, ['code' => 'google_not_configured']);
        } catch (SocialAuthEmailLinkRequired $exception) {
            return $this->fail($exception->getMessage(), 409, ['code' => 'link_required']);
        } catch (InvalidGoogleIdToken $exception) {
            return $this->fail($exception->getMessage(), 401, ['code' => 'invalid_google_credential']);
        }

        return $this->sessionResponseFactory->create($request, [], $user);
    }
}
