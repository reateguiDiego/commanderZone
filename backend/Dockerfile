FROM composer:2 AS composer

FROM dunglas/frankenphp:1-php8.4-bookworm

WORKDIR /app

RUN install-php-extensions \
	pdo_pgsql \
	intl \
	zip \
	opcache

COPY --from=composer /usr/bin/composer /usr/bin/composer

COPY composer.json composer.lock symfony.lock ./
RUN composer install --no-interaction --prefer-dist --optimize-autoloader --no-scripts

COPY . .
COPY Caddyfile /etc/frankenphp/Caddyfile

RUN composer run-script post-install-cmd
RUN mkdir -p var/cache var/log && chmod -R 777 var

EXPOSE 80

CMD ["frankenphp", "run", "--config", "/etc/frankenphp/Caddyfile"]
