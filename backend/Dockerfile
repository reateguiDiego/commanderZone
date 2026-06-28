FROM composer:2 AS composer

FROM dunglas/frankenphp:1-php8.4-bookworm

WORKDIR /app

RUN install-php-extensions \
	pdo_pgsql \
	intl \
	zip \
	opcache

RUN echo "memory_limit=512M" > /usr/local/etc/php/conf.d/commanderzone-memory.ini

COPY --from=composer /usr/bin/composer /usr/bin/composer

COPY composer.json composer.lock symfony.lock ./
# GitHub codeload can intermittently reject Docker build downloads over HTTP/2.
RUN set -eux; \
	export COMPOSER_ALLOW_SUPERUSER=1 COMPOSER_IPRESOLVE=4 COMPOSER_MAX_PARALLEL_HTTP=1; \
	for attempt in 1 2 3; do \
		if composer install --no-interaction --prefer-dist --optimize-autoloader --no-scripts; then \
			break; \
		fi; \
		if [ "$attempt" = "3" ]; then \
			exit 1; \
		fi; \
		composer clear-cache --no-interaction || true; \
		sleep $((attempt * 5)); \
	done

COPY . .
COPY Caddyfile /etc/frankenphp/Caddyfile

RUN composer run-script post-install-cmd
RUN mkdir -p var/cache var/log && chmod -R 777 var

EXPOSE 80

CMD ["frankenphp", "run", "--config", "/etc/frankenphp/Caddyfile"]
