<?php

namespace App\UI\Http;

use App\Application\Moderation\ModerationSummaryPublisher;
use App\Domain\User\Role;
use App\Domain\User\User;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Mercure\Authorization;
use Symfony\Component\Mercure\Exception\RuntimeException as MercureRuntimeException;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class MercureController extends ApiController
{
    #[Route('/realtime/mercure-cookie', methods: ['POST'])]
    public function authorize(Request $request, Authorization $authorization, #[CurrentUser] User $user): JsonResponse
    {
        $topics = [
            'friends/users/'.$user->id(),
            'rooms/invites/users/'.$user->id(),
            'messages/users/'.$user->id(),
        ];
        if ($user->hasRole(Role::ADMIN) || $user->hasRole(Role::OWNER)) {
            $topics[] = ModerationSummaryPublisher::TOPIC;
        }

        try {
            $authorization->setCookie($request, $topics);
        } catch (MercureRuntimeException $exception) {
            if (str_contains($exception->getMessage(), 'different second-level domain')) {
                // In local setups, localhost and 127.0.0.1 are treated as different domains.
                // Do not fail hard: Mercure can still work when the hub allows anonymous subscribers.
                return $this->json(null, 204);
            }

            throw $exception;
        }

        return $this->json(null, 204);
    }
}
