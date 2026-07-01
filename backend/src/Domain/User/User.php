<?php

namespace App\Domain\User;

use App\Domain\Localization\LanguageCatalog;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Security\Core\User\PasswordAuthenticatedUserInterface;
use Symfony\Component\Security\Core\User\UserInterface;
use Symfony\Component\Uid\Uuid;

#[ORM\Entity]
#[ORM\Table(name: 'app_user')]
#[ORM\UniqueConstraint(name: 'uniq_user_email', columns: ['email'])]
#[ORM\UniqueConstraint(name: 'uniq_user_display_name', columns: ['display_name'])]
class User implements UserInterface, PasswordAuthenticatedUserInterface
{
    public const PREMIUM_TIER_NONE = 'none';
    public const PREMIUM_TIER_1 = 'tier1';
    public const PREMIUM_TIER_2 = 'tier2';
    public const PREMIUM_TIER_3 = 'tier3';

    private const DEFAULT_INITIAL_BACKGROUND_COLOR = '#edcd83';
    private const DEFAULT_INITIAL_TEXT_COLOR = '#16120a';
    private const DEFAULT_DISPLAY_NAME_STYLE_PRESET = 'plain';

    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 36)]
    private string $id;

    #[ORM\Column(type: 'string', length: 180)]
    private string $email;

    #[ORM\Column(type: 'datetime_immutable', nullable: true)]
    private ?\DateTimeImmutable $emailVerifiedAt = null;

    #[ORM\Column(type: 'string', length: 180, nullable: true)]
    private ?string $pendingEmail = null;

    #[ORM\Column(type: 'string', length: 20)]
    private string $displayName;

    #[ORM\Column(type: 'string', length: 48)]
    private string $displayNameStylePreset = self::DEFAULT_DISPLAY_NAME_STYLE_PRESET;

    #[ORM\Column(type: 'string', length: 7, nullable: true)]
    private ?string $displayNameStyleTextColor = null;

    #[ORM\Column(type: 'string')]
    private string $password;

    #[ORM\ManyToMany(targetEntity: Role::class)]
    #[ORM\JoinTable(name: 'app_user_role')]
    #[ORM\JoinColumn(name: 'user_id', referencedColumnName: 'id', nullable: false, onDelete: 'CASCADE')]
    #[ORM\InverseJoinColumn(name: 'role_code', referencedColumnName: 'code', nullable: false, onDelete: 'CASCADE')]
    private Collection $roles;

    #[ORM\Column(type: 'string', length: 16)]
    private string $premiumTier = self::PREMIUM_TIER_NONE;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $createdAt;

    #[ORM\Column(type: 'datetime_immutable')]
    private \DateTimeImmutable $updatedAt;

    #[ORM\Column(type: 'datetime_immutable', nullable: true)]
    private ?\DateTimeImmutable $lastSeenAt = null;

    #[ORM\Column(type: 'string', length: 16)]
    private string $avatarType = 'initial';

    #[ORM\Column(type: 'string', length: 160, nullable: true)]
    private ?string $avatarPreset = null;

    #[ORM\Column(type: 'text', nullable: true)]
    private ?string $avatarImageData = null;

    #[ORM\Column(type: 'string', length: 2, nullable: true)]
    private ?string $avatarInitialLetter = null;

    #[ORM\Column(type: 'string', length: 7, nullable: true)]
    private ?string $avatarInitialBackgroundColor = null;

    #[ORM\Column(type: 'string', length: 7, nullable: true)]
    private ?string $avatarInitialTextColor = null;

    #[ORM\Column(type: 'string', length: 8)]
    private string $cardLanguage = LanguageCatalog::DEFAULT_LANGUAGE;

    #[ORM\Column(type: 'string', length: 8)]
    private string $appLanguage = LanguageCatalog::DEFAULT_LANGUAGE;

    #[ORM\Column(type: 'string', length: 48)]
    private string $themeId = UserThemeCatalog::DEFAULT_THEME;

    #[ORM\Column(type: 'boolean')]
    private bool $showManaHelperOnStartup = false;

    #[ORM\Column(type: 'boolean')]
    private bool $enableManaRow = true;

    #[ORM\Column(type: 'boolean')]
    private bool $enableStackMana = false;

    #[ORM\Column(type: 'boolean')]
    private bool $gameAnimations = true;

    #[ORM\Column(type: 'boolean')]
    private bool $chatNotificationSounds = true;

    public function __construct(string $email, string $displayName)
    {
        $this->id = Uuid::v7()->toRfc4122();
        $this->email = mb_strtolower(trim($email));
        $this->displayName = trim($displayName);
        $this->createdAt = new \DateTimeImmutable();
        $this->updatedAt = $this->createdAt;
        $this->roles = new ArrayCollection();
    }

    public function id(): string
    {
        return $this->id;
    }

    public function email(): string
    {
        return $this->email;
    }

    public function displayName(): string
    {
        return $this->displayName;
    }

    public function rename(string $displayName): void
    {
        $this->displayName = trim($displayName);
        $this->touch();
    }

    public function selectDisplayNameStyle(string $presetId, ?string $textColor = null): void
    {
        $this->displayNameStylePreset = trim($presetId);
        $this->displayNameStyleTextColor = $textColor;
        $this->touch();
    }

    public function resetDisplayNameStyle(): void
    {
        $this->displayNameStylePreset = self::DEFAULT_DISPLAY_NAME_STYLE_PRESET;
        $this->displayNameStyleTextColor = null;
        $this->touch();
    }

    public function changeEmail(string $email): void
    {
        $this->email = mb_strtolower(trim($email));
        $this->touch();
    }

    public function isEmailVerified(): bool
    {
        return $this->emailVerifiedAt !== null;
    }

    public function markEmailVerified(?\DateTimeImmutable $verifiedAt = null): void
    {
        $this->emailVerifiedAt = $verifiedAt ?? new \DateTimeImmutable();
        $this->touch();
    }

    public function pendingEmail(): ?string
    {
        return $this->pendingEmail;
    }

    public function startEmailChange(string $newEmail): void
    {
        $this->pendingEmail = mb_strtolower(trim($newEmail));
        $this->touch();
    }

    public function applyPendingEmail(): void
    {
        if ($this->pendingEmail === null) {
            return;
        }

        $this->email = $this->pendingEmail;
        $this->pendingEmail = null;
        $this->emailVerifiedAt = new \DateTimeImmutable();
        $this->touch();
    }

    public function clearPendingEmail(): void
    {
        $this->pendingEmail = null;
        $this->touch();
    }

    public function setPassword(string $password): void
    {
        $this->password = $password;
        $this->touch();
    }

    public function getPassword(): ?string
    {
        return $this->password;
    }

    public function getRoles(): array
    {
        $roles = [Role::USER];
        foreach ($this->roles as $role) {
            if ($role instanceof Role) {
                $roles[] = $role->code();
            }
        }

        return array_values(array_unique($roles));
    }

    public function grantRole(Role $role): void
    {
        foreach ($this->roles as $currentRole) {
            if ($currentRole instanceof Role && $currentRole->code() === $role->code()) {
                return;
            }
        }

        $this->roles->add($role);
        $this->touch();
    }

    public function revokeRole(string $roleCode): void
    {
        foreach ($this->roles as $role) {
            if (!$role instanceof Role || $role->code() !== $roleCode) {
                continue;
            }

            $this->roles->removeElement($role);
            $this->touch();

            return;
        }
    }

    public function hasRole(string $roleCode): bool
    {
        return in_array($roleCode, $this->getRoles(), true);
    }

    public function eraseCredentials(): void
    {
    }

    public function getUserIdentifier(): string
    {
        return $this->id;
    }

    public function lastSeenAt(): ?\DateTimeImmutable
    {
        return $this->lastSeenAt;
    }

    public function createdAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function markSeen(?\DateTimeImmutable $seenAt = null): void
    {
        $this->lastSeenAt = $seenAt ?? new \DateTimeImmutable();
        $this->touch();
    }

    public function markOffline(): void
    {
        $this->lastSeenAt = null;
        $this->touch();
    }

    public function useInitialAvatar(?string $letter = null, ?string $backgroundColor = null, ?string $textColor = null): void
    {
        $this->avatarType = 'initial';
        $this->avatarPreset = null;
        $this->avatarImageData = null;
        $this->avatarInitialLetter = $letter;
        $this->avatarInitialBackgroundColor = $backgroundColor;
        $this->avatarInitialTextColor = $textColor;
        $this->touch();
    }

    public function selectPresetAvatar(string $avatarPreset): void
    {
        $this->avatarType = 'preset';
        $this->avatarPreset = $avatarPreset;
        $this->avatarImageData = null;
        $this->touch();
    }

    public function uploadAvatarImage(string $avatarImageData): void
    {
        $this->avatarType = 'upload';
        $this->avatarPreset = null;
        $this->avatarImageData = $avatarImageData;
        $this->touch();
    }

    public function avatarImageData(): ?string
    {
        return $this->avatarImageData;
    }

    public function avatar(): array
    {
        $avatar = [
            'type' => $this->avatarType,
            'imageUrl' => match ($this->avatarType) {
                'preset' => $this->avatarPreset,
                'upload' => sprintf('/users/%s/avatar', $this->id),
                default => null,
            },
        ];

        if ($this->avatarType === 'initial') {
            $avatar['initial'] = [
                'letter' => $this->avatarInitialLetter ?? $this->defaultInitialLetter(),
                'backgroundColor' => $this->avatarInitialBackgroundColor ?? self::DEFAULT_INITIAL_BACKGROUND_COLOR,
                'textColor' => $this->avatarInitialTextColor ?? self::DEFAULT_INITIAL_TEXT_COLOR,
            ];
        }

        return $avatar;
    }

    public function displayNameStyle(): array
    {
        $style = [
            'type' => $this->displayNameStylePreset === self::DEFAULT_DISPLAY_NAME_STYLE_PRESET ? 'plain' : 'preset',
            'presetId' => $this->displayNameStylePreset,
        ];

        if ($this->displayNameStyleTextColor !== null) {
            $style['textColor'] = $this->displayNameStyleTextColor;
        }

        return $style;
    }

    public function cardLanguage(): string
    {
        return $this->cardLanguage;
    }

    public function appLanguage(): string
    {
        return $this->appLanguage;
    }

    public function themeId(): string
    {
        return $this->themeId;
    }

    public function premiumTier(): string
    {
        return $this->premiumTier;
    }

    public function updatePremiumTier(string $premiumTier): void
    {
        if (!self::isSupportedPremiumTier($premiumTier)) {
            throw new \InvalidArgumentException('Unsupported premium tier.');
        }

        if ($this->premiumTier === $premiumTier) {
            return;
        }

        $this->premiumTier = $premiumTier;
        $this->touch();
    }

    /**
     * @return list<string>
     */
    public static function supportedPremiumTiers(): array
    {
        return [
            self::PREMIUM_TIER_NONE,
            self::PREMIUM_TIER_1,
            self::PREMIUM_TIER_2,
            self::PREMIUM_TIER_3,
        ];
    }

    public static function isSupportedPremiumTier(string $premiumTier): bool
    {
        return in_array($premiumTier, self::supportedPremiumTiers(), true);
    }

    public function updateCardLanguage(string $language): void
    {
        if (!LanguageCatalog::isSupportedCardLanguage($language)) {
            throw new \InvalidArgumentException('Unsupported card language.');
        }

        $this->cardLanguage = $language;
        $this->touch();
    }

    public function updateAppLanguage(string $language): void
    {
        if (!LanguageCatalog::isSupportedAppLanguage($language)) {
            throw new \InvalidArgumentException('Unsupported app language.');
        }

        $this->appLanguage = $language;
        $this->touch();
    }

    public function updateTheme(string $themeId): void
    {
        if (!UserThemeCatalog::isSupported($themeId)) {
            throw new \InvalidArgumentException('Unsupported theme.');
        }

        $this->themeId = $themeId;
        $this->touch();
    }

    /**
     * @param array{
     *   showManaHelperOnStartup?: bool,
     *   enableManaRow?: bool,
     *   enableStackMana?: bool,
     *   gameAnimations?: bool,
     *   chatNotificationSounds?: bool
     * } $preferences
     */
    public function updateGamePreferences(array $preferences): void
    {
        foreach ($preferences as $key => $value) {
            match ($key) {
                'showManaHelperOnStartup' => $this->showManaHelperOnStartup = $value,
                'enableManaRow' => $this->enableManaRow = $value,
                'enableStackMana' => $this->enableStackMana = $value,
                'gameAnimations' => $this->gameAnimations = $value,
                'chatNotificationSounds' => $this->chatNotificationSounds = $value,
                default => throw new \InvalidArgumentException('Unsupported game preference.'),
            };
        }

        if ($preferences !== []) {
            $this->touch();
        }
    }

    public function gamePreferences(): array
    {
        return [
            'showManaHelperOnStartup' => $this->showManaHelperOnStartup,
            'enableManaRow' => $this->enableManaRow,
            'enableStackMana' => $this->enableStackMana,
            'gameAnimations' => $this->gameAnimations,
            'chatNotificationSounds' => $this->chatNotificationSounds,
        ];
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'email' => $this->email,
            'emailVerified' => $this->isEmailVerified(),
            'pendingEmail' => $this->pendingEmail,
            'displayName' => $this->displayName,
            'displayNameStyle' => $this->displayNameStyle(),
            'preferences' => [
                'cardLanguage' => $this->cardLanguage,
                'appLanguage' => $this->appLanguage,
                'themeId' => $this->themeId,
                'game' => $this->gamePreferences(),
            ],
            'roles' => $this->getRoles(),
            'premiumTier' => $this->premiumTier,
            'avatar' => $this->avatar(),
            'createdAt' => $this->createdAt->format(DATE_ATOM),
            'updatedAt' => $this->updatedAt->format(DATE_ATOM),
        ];
    }

    private function touch(): void
    {
        $this->updatedAt = new \DateTimeImmutable();
    }

    private function defaultInitialLetter(): string
    {
        $letter = mb_strtoupper(mb_substr(trim($this->displayName), 0, 1));

        return $letter !== '' ? $letter : 'P';
    }
}
