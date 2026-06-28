<?php

namespace App\UI\Http;

use App\Application\Auth\AuthThrottleService;
use App\Application\Contact\ContactMailer;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

class ContactController extends ApiController
{
    private const REQUEST_WINDOW_SECONDS = 900;
    private const REQUEST_LIMIT_PER_IP = 5;
    private const REQUEST_LIMIT_PER_EMAIL = 3;
    private const MAX_NAME_LENGTH = 30;
    private const MAX_SUBJECT_LENGTH = 30;
    private const MAX_MESSAGE_LENGTH = 500;

    public function __construct(
        private readonly AuthThrottleService $authThrottleService,
        private readonly ContactMailer $contactMailer,
    ) {
    }

    #[Route('/contact', methods: ['POST'])]
    public function create(Request $request): JsonResponse
    {
        $payload = $this->payload($request);
        $name = trim((string) ($payload['name'] ?? ''));
        $email = mb_strtolower(trim((string) ($payload['email'] ?? '')));
        $subject = trim((string) ($payload['subject'] ?? ''));
        $message = trim((string) ($payload['message'] ?? ''));
        $clientIp = trim((string) $request->getClientIp());

        if (!$this->isValidPayload($name, $email, $subject, $message)) {
            return $this->fail('name, email, subject and message are required and must be valid.', 400);
        }

        $ipLimit = $this->authThrottleService->limitStatus('contact-ip', $clientIp, self::REQUEST_LIMIT_PER_IP, self::REQUEST_WINDOW_SECONDS);
        $emailLimit = $this->authThrottleService->limitStatus('contact-email', $email, self::REQUEST_LIMIT_PER_EMAIL, self::REQUEST_WINDOW_SECONDS);

        if ($ipLimit['limited'] || $emailLimit['limited']) {
            $retryAfterSeconds = max($ipLimit['retryAfterSeconds'], $emailLimit['retryAfterSeconds']);
            $response = $this->fail('Too many contact requests. Please try again later.', 429, [
                'retryAfterSeconds' => $retryAfterSeconds,
            ]);
            $response->headers->set('Retry-After', (string) $retryAfterSeconds);

            return $response;
        }

        $this->authThrottleService->consume('contact-ip', $clientIp, self::REQUEST_WINDOW_SECONDS);
        $this->authThrottleService->consume('contact-email', $email, self::REQUEST_WINDOW_SECONDS);

        try {
            $this->contactMailer->send($name, $email, $subject, $message);
        } catch (\Throwable) {
            return $this->fail('We could not send your message right now. Please try again later.', 503);
        }

        return $this->json(['accepted' => true], 202);
    }

    private function isValidPayload(string $name, string $email, string $subject, string $message): bool
    {
        return $name !== ''
            && mb_strlen($name) <= self::MAX_NAME_LENGTH
            && filter_var($email, FILTER_VALIDATE_EMAIL) !== false
            && $subject !== ''
            && mb_strlen($subject) <= self::MAX_SUBJECT_LENGTH
            && $message !== ''
            && mb_strlen($message) <= self::MAX_MESSAGE_LENGTH;
    }
}
