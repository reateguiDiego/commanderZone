<?php

namespace App\Domain\User;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
#[ORM\Table(name: 'app_role')]
class Role
{
    public const USER = 'ROLE_USER';
    public const ADMIN = 'ROLE_ADMIN';
    public const OWNER = 'ROLE_OWNER';

    #[ORM\Id]
    #[ORM\Column(type: 'string', length: 32)]
    private string $code;

    #[ORM\Column(type: 'string', length: 80)]
    private string $label;

    public function __construct(string $code, string $label)
    {
        if (!self::isSupported($code)) {
            throw new \InvalidArgumentException('Unsupported role.');
        }

        $this->code = $code;
        $this->label = trim($label);
    }

    public function code(): string
    {
        return $this->code;
    }

    public function label(): string
    {
        return $this->label;
    }

    public static function isSupported(string $code): bool
    {
        return in_array($code, self::supportedCodes(), true);
    }

    /**
     * @return list<string>
     */
    public static function supportedCodes(): array
    {
        return [
            self::USER,
            self::ADMIN,
            self::OWNER,
        ];
    }
}
