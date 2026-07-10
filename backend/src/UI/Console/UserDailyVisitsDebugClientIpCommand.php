<?php

namespace App\UI\Console;

use App\Application\User\IpGeolocationServiceInterface;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Symfony\Component\HttpFoundation\Request;

#[AsCommand(name: 'app:user-daily-visits:debug-client-ip', description: 'Shows how Symfony resolves a client IP from proxy headers without persisting visit data.')]
final class UserDailyVisitsDebugClientIpCommand extends Command
{
    public function __construct(private readonly IpGeolocationServiceInterface $geolocation)
    {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this
            ->addOption('remote-addr', null, InputOption::VALUE_REQUIRED, 'REMOTE_ADDR seen by PHP/Symfony.', '127.0.0.1')
            ->addOption('x-forwarded-for', null, InputOption::VALUE_REQUIRED, 'X-Forwarded-For header value.')
            ->addOption('x-real-ip', null, InputOption::VALUE_REQUIRED, 'X-Real-IP header value.')
            ->addOption('x-forwarded-proto', null, InputOption::VALUE_REQUIRED, 'X-Forwarded-Proto header value.')
            ->addOption('x-forwarded-host', null, InputOption::VALUE_REQUIRED, 'X-Forwarded-Host header value.')
            ->addOption('forwarded', null, InputOption::VALUE_REQUIRED, 'Forwarded header value.')
            ->addOption('cf-connecting-ip', null, InputOption::VALUE_REQUIRED, 'CF-Connecting-IP header value.');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $server = ['REMOTE_ADDR' => $this->stringOption($input, 'remote-addr') ?? '127.0.0.1'];
        $this->addHeader($server, $input, 'x-forwarded-for', 'HTTP_X_FORWARDED_FOR');
        $this->addHeader($server, $input, 'x-real-ip', 'HTTP_X_REAL_IP');
        $this->addHeader($server, $input, 'x-forwarded-proto', 'HTTP_X_FORWARDED_PROTO');
        $this->addHeader($server, $input, 'x-forwarded-host', 'HTTP_X_FORWARDED_HOST');
        $this->addHeader($server, $input, 'forwarded', 'HTTP_FORWARDED');
        $this->addHeader($server, $input, 'cf-connecting-ip', 'HTTP_CF_CONNECTING_IP');

        $request = Request::create('/_debug/client-ip', 'GET', [], [], [], $server);
        $clientIp = $request->getClientIp();
        $geo = $this->geolocation->locate($clientIp);

        $output->writeln('User daily visit client IP debug');
        $output->writeln(sprintf('- REMOTE_ADDR: %s', $server['REMOTE_ADDR']));
        $output->writeln(sprintf('- Request::getClientIp(): %s', $clientIp ?? '(null)'));
        $output->writeln(sprintf('- Trusted proxies: %s', Request::getTrustedProxies() === [] ? '(none)' : implode(', ', Request::getTrustedProxies())));
        $output->writeln(sprintf('- Trusted header bitmask: %d', Request::getTrustedHeaderSet()));
        $output->writeln(sprintf('- X-Forwarded-For present: %s', isset($server['HTTP_X_FORWARDED_FOR']) ? 'yes' : 'no'));
        $output->writeln(sprintf('- X-Real-IP present: %s', isset($server['HTTP_X_REAL_IP']) ? 'yes' : 'no'));
        $output->writeln(sprintf('- Forwarded present: %s', isset($server['HTTP_FORWARDED']) ? 'yes' : 'no'));
        $output->writeln(sprintf('- X-Forwarded-Proto present: %s', isset($server['HTTP_X_FORWARDED_PROTO']) ? 'yes' : 'no'));
        $output->writeln(sprintf('- X-Forwarded-Host present: %s', isset($server['HTTP_X_FORWARDED_HOST']) ? 'yes' : 'no'));
        $output->writeln(sprintf('- CF-Connecting-IP present: %s', isset($server['HTTP_CF_CONNECTING_IP']) ? 'yes' : 'no'));
        $output->writeln(sprintf('- Geo source: %s', $geo->source() ?? '(null)'));
        $output->writeln(sprintf('- Country: %s %s', $geo->countryCode() ?? '(null)', $geo->countryName() ?? ''));

        return Command::SUCCESS;
    }

    /**
     * @param array<string,string> $server
     */
    private function addHeader(array &$server, InputInterface $input, string $option, string $serverKey): void
    {
        $value = $this->stringOption($input, $option);
        if ($value === null) {
            return;
        }

        $server[$serverKey] = $value;
    }

    private function stringOption(InputInterface $input, string $name): ?string
    {
        $value = $input->getOption($name);
        if (!is_scalar($value)) {
            return null;
        }

        $trimmed = trim((string) $value);

        return $trimmed !== '' ? $trimmed : null;
    }
}
