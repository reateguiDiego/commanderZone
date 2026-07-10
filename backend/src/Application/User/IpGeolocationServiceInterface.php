<?php

namespace App\Application\User;

interface IpGeolocationServiceInterface
{
    public function locate(?string $ip): IpGeolocationResult;
}
