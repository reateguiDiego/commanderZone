<?php

namespace App\UI\Http;

use App\Domain\Deck\Deck;
use App\Domain\Deck\DeckFolder;
use App\Domain\User\User;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\CurrentUser;

class DeckFoldersController extends ApiController
{
    #[Route('/deck-folders', methods: ['GET'])]
    public function list(#[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $folders = $entityManager->getRepository(DeckFolder::class)->findBy(['owner' => $user], ['id' => 'DESC']);

        return $this->json(['data' => array_map(static fn (DeckFolder $folder) => $folder->toArray(), $folders)]);
    }

    #[Route('/deck-folders', methods: ['POST'])]
    public function create(Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $name = trim((string) ($this->payload($request)['name'] ?? ''));
        if ($name === '') {
            return $this->fail('Folder name is required.');
        }

        $folder = new DeckFolder($user, $name);
        $entityManager->persist($folder);
        $entityManager->flush();

        return $this->json(['folder' => $folder->toArray()], 201);
    }

    #[Route('/deck-folders/names', methods: ['GET'])]
    public function names(#[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $folders = $entityManager->getRepository(DeckFolder::class)->findBy(['owner' => $user], ['id' => 'DESC']);

        return $this->json([
            'data' => array_map(
                static fn (DeckFolder $folder) => [
                    'id' => $folder->id(),
                    'name' => $folder->toArray()['name'],
                ],
                $folders,
            ),
        ]);
    }

    #[Route('/deck-folders/{id}', methods: ['PATCH'])]
    public function update(string $id, Request $request, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $folder = $this->ownedFolder($id, $user, $entityManager);
        if (!$folder) {
            return $this->fail('Folder not found.', 404);
        }

        $name = trim((string) ($this->payload($request)['name'] ?? ''));
        if ($name === '') {
            return $this->fail('Folder name is required.');
        }

        $folder->rename($name);
        $entityManager->flush();

        return $this->json(['folder' => $folder->toArray()]);
    }

    #[Route('/deck-folders/{id}', methods: ['DELETE'])]
    public function delete(string $id, #[CurrentUser] User $user, EntityManagerInterface $entityManager): JsonResponse
    {
        $folder = $this->ownedFolder($id, $user, $entityManager);
        if (!$folder) {
            return $this->fail('Folder not found.', 404);
        }

        foreach ($entityManager->getRepository(Deck::class)->findBy(['owner' => $user, 'folder' => $folder]) as $deck) {
            $deck->moveToFolder(null);
        }

        $entityManager->remove($folder);
        $entityManager->flush();

        return $this->json(null, 204);
    }

    private function ownedFolder(string $id, User $user, EntityManagerInterface $entityManager): ?DeckFolder
    {
        $folder = $entityManager->getRepository(DeckFolder::class)->find($id);

        return $folder instanceof DeckFolder && $folder->owner()->id() === $user->id() ? $folder : null;
    }
}
