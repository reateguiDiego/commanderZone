-- Seeds 500 verified load-test users and one private Commander deck per user.
--
-- Intended for local/test load data only. Run from psql, for example:
--   psql "$DATABASE_URL" -f scripts/seed-load-test-users.sql
--
-- Generated accounts:
--   email:    test01@test.com ... test500@test.com
--   username: test01 ... test500
--   password: 12345aA!

BEGIN;

WITH params AS (
    SELECT
        1 AS first_index,
        500 AS user_count,
        'test'::text AS account_prefix,
        'test.com'::text AS email_domain,
        -- bcrypt hash for 12345aA!, accepted by Symfony's auto password hasher.
        '$2y$12$rBZ/Xl0xRhiDCsb8Zl25U.HpANodeMPX9F8Z0WUIkSnNJw69EhKgS'::text AS password_hash
),
numbers AS (
    SELECT generate_series(first_index, first_index + user_count - 1) AS n
    FROM params
),
load_users AS (
    SELECT
        n,
        account_prefix || CASE WHEN n < 100 THEN lpad(n::text, 2, '0') ELSE n::text END AS username,
        account_prefix || CASE WHEN n < 100 THEN lpad(n::text, 2, '0') ELSE n::text END || '@' || email_domain AS email,
        substr(md5('commanderzone-load-test-user-' || n::text), 1, 8)
            || '-' || substr(md5('commanderzone-load-test-user-' || n::text), 9, 4)
            || '-' || substr(md5('commanderzone-load-test-user-' || n::text), 13, 4)
            || '-' || substr(md5('commanderzone-load-test-user-' || n::text), 17, 4)
            || '-' || substr(md5('commanderzone-load-test-user-' || n::text), 21, 12) AS user_id,
        substr(md5('commanderzone-load-test-deck-' || n::text), 1, 8)
            || '-' || substr(md5('commanderzone-load-test-deck-' || n::text), 9, 4)
            || '-' || substr(md5('commanderzone-load-test-deck-' || n::text), 13, 4)
            || '-' || substr(md5('commanderzone-load-test-deck-' || n::text), 17, 4)
            || '-' || substr(md5('commanderzone-load-test-deck-' || n::text), 21, 12) AS deck_id,
        password_hash
    FROM numbers
    CROSS JOIN params
),
role_seed AS (
    INSERT INTO app_role (code, label)
    VALUES
        ('ROLE_USER', 'User'),
        ('ROLE_ADMIN', 'Admin'),
        ('ROLE_OWNER', 'Owner')
    ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label
    RETURNING code
),
upserted_users AS (
    INSERT INTO app_user (
        id,
        email,
        email_verified_at,
        pending_email,
        display_name,
        public_handle,
        display_name_style_preset,
        display_name_style_text_color,
        password,
        premium_tier,
        created_at,
        updated_at,
        last_seen_at,
        avatar_type,
        avatar_preset,
        avatar_image_data,
        avatar_initial_letter,
        avatar_initial_background_color,
        avatar_initial_text_color,
        card_language,
        app_language,
        theme_id,
        show_mana_helper_on_startup,
        enable_mana_row,
        enable_stack_mana,
        game_animations,
        chat_notification_sounds
    )
    SELECT DISTINCT ON (email)
        user_id,
        email,
        NOW(),
        NULL,
        username,
        username || '-' || right(replace(user_id, '-', ''), 8),
        'plain',
        NULL,
        password_hash,
        'none',
        NOW(),
        NOW(),
        NULL,
        'initial',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        'en',
        'en',
        'sunrise',
        false,
        true,
        false,
        true,
        true
    FROM load_users
    ORDER BY email, n
    ON CONFLICT (email) DO UPDATE SET
        email_verified_at = NOW(),
        pending_email = NULL,
        display_name = EXCLUDED.display_name,
        public_handle = EXCLUDED.public_handle,
        display_name_style_preset = EXCLUDED.display_name_style_preset,
        display_name_style_text_color = NULL,
        password = EXCLUDED.password,
        premium_tier = 'none',
        updated_at = NOW(),
        avatar_type = 'initial',
        card_language = 'en',
        app_language = 'en',
        theme_id = 'sunrise',
        show_mana_helper_on_startup = false,
        enable_mana_row = true,
        enable_stack_mana = false,
        game_animations = true,
        chat_notification_sounds = true
    RETURNING id, email
),
user_roles AS (
    INSERT INTO app_user_role (user_id, role_code)
    SELECT DISTINCT ON (id) id, 'ROLE_USER'
    FROM upserted_users
    ORDER BY id
    ON CONFLICT DO NOTHING
    RETURNING user_id
),
load_cards AS (
    SELECT
        'a1111111-1111-4111-8111-111111111111'::text AS id,
        '99999999-0000-0000-0000-000000000001'::text AS scryfall_id,
        '99999999-0000-0000-0000-000000000001'::text AS oracle_id,
        'CommanderZone Load Test Commander'::text AS name,
        'commanderzone load test commander'::text AS normalized_name,
        '{0}'::text AS mana_cost,
        'Legendary Creature - Avatar'::text AS type_line,
        'CommanderZone load-test fixture.'::text AS oracle_text,
        '1'::text AS power,
        '1'::text AS toughness,
        NULL::text AS loyalty,
        '{"root":{"power":"1","toughness":"1","loyalty":null,"defense":null,"handModifier":null,"lifeModifier":null},"faces":[]}'::json AS face_stats,
        '[]'::json AS colors,
        '[]'::json AS color_identity,
        '{"commander":"legal"}'::json AS legalities,
        '{}'::json AS image_uris,
        '[]'::json AS card_faces,
        '[]'::json AS all_parts,
        0::double precision AS mana_value,
        '[]'::json AS produced_mana,
        '{}'::json AS prices,
        'normal'::text AS layout,
        true AS commander_legal,
        'czlt'::text AS set_code,
        'CommanderZone Load Tests'::text AS set_name,
        'common'::text AS rarity,
        '1'::text AS collector_number,
        'en'::text AS lang,
        NULL::text AS printed_name,
        NULL::text AS flavor_name,
        'highres_scan'::text AS image_status,
        false AS has_rulings
    UNION ALL
    SELECT
        'b2222222-2222-4222-8222-222222222222',
        '99999999-0000-0000-0000-000000000002',
        '99999999-0000-0000-0000-000000000002',
        'CommanderZone Load Test Wastes',
        'commanderzone load test wastes',
        NULL,
        'Basic Land',
        '{T}: Add {C}.',
        NULL,
        NULL,
        NULL,
        '{"root":{"power":null,"toughness":null,"loyalty":null,"defense":null,"handModifier":null,"lifeModifier":null},"faces":[]}'::json,
        '[]'::json,
        '[]'::json,
        '{"commander":"legal"}'::json,
        '{}'::json,
        '[]'::json,
        '[]'::json,
        0::double precision,
        '["C"]'::json,
        '{}'::json,
        'normal',
        true,
        'czlt',
        'CommanderZone Load Tests',
        'common',
        '2',
        'en',
        NULL,
        NULL,
        'highres_scan',
        false
),
upserted_cards AS (
    INSERT INTO card (
        id,
        scryfall_id,
        oracle_id,
        name,
        normalized_name,
        mana_cost,
        type_line,
        oracle_text,
        power,
        toughness,
        loyalty,
        face_stats,
        colors,
        color_identity,
        legalities,
        image_uris,
        card_faces,
        all_parts,
        mana_value,
        produced_mana,
        prices,
        layout,
        commander_legal,
        set_code,
        set_name,
        rarity,
        collector_number,
        lang,
        printed_name,
        flavor_name,
        image_status,
        has_rulings,
        updated_at
    )
    SELECT DISTINCT ON (scryfall_id)
        id,
        scryfall_id,
        oracle_id,
        name,
        normalized_name,
        mana_cost,
        type_line,
        oracle_text,
        power,
        toughness,
        loyalty,
        face_stats,
        colors,
        color_identity,
        legalities,
        image_uris,
        card_faces,
        all_parts,
        mana_value,
        produced_mana,
        prices,
        layout,
        commander_legal,
        set_code,
        set_name,
        rarity,
        collector_number,
        lang,
        printed_name,
        flavor_name,
        image_status,
        has_rulings,
        NOW()
    FROM load_cards
    ORDER BY scryfall_id
    ON CONFLICT (scryfall_id) DO UPDATE SET
        oracle_id = EXCLUDED.oracle_id,
        name = EXCLUDED.name,
        normalized_name = EXCLUDED.normalized_name,
        mana_cost = EXCLUDED.mana_cost,
        type_line = EXCLUDED.type_line,
        oracle_text = EXCLUDED.oracle_text,
        power = EXCLUDED.power,
        toughness = EXCLUDED.toughness,
        loyalty = EXCLUDED.loyalty,
        face_stats = EXCLUDED.face_stats,
        colors = EXCLUDED.colors,
        color_identity = EXCLUDED.color_identity,
        legalities = EXCLUDED.legalities,
        image_uris = EXCLUDED.image_uris,
        card_faces = EXCLUDED.card_faces,
        all_parts = EXCLUDED.all_parts,
        mana_value = EXCLUDED.mana_value,
        produced_mana = EXCLUDED.produced_mana,
        prices = EXCLUDED.prices,
        layout = EXCLUDED.layout,
        commander_legal = EXCLUDED.commander_legal,
        set_code = EXCLUDED.set_code,
        set_name = EXCLUDED.set_name,
        rarity = EXCLUDED.rarity,
        collector_number = EXCLUDED.collector_number,
        lang = EXCLUDED.lang,
        printed_name = EXCLUDED.printed_name,
        flavor_name = EXCLUDED.flavor_name,
        image_status = EXCLUDED.image_status,
        has_rulings = EXCLUDED.has_rulings,
        updated_at = NOW()
    RETURNING id, scryfall_id
),
upserted_decks AS (
    INSERT INTO deck (
        id,
        owner_id,
        name,
        format,
        visibility,
        slug,
        public_slug,
        is_valid,
        background_name,
        sleeves_name,
        folder_id,
        created_at,
        updated_at
    )
    SELECT DISTINCT ON (load_users.deck_id)
        load_users.deck_id,
        upserted_users.id,
        'Load Test Deck',
        'commander',
        'private',
        'commanderzone-load-test-commander-load-test-deck-commander-' || right(replace(load_users.deck_id, '-', ''), 8),
        NULL,
        true,
        'free_0',
        'facedown_card',
        NULL,
        NOW(),
        NOW()
    FROM load_users
    INNER JOIN upserted_users ON upserted_users.email = load_users.email
    ORDER BY load_users.deck_id, load_users.n
    ON CONFLICT (id) DO UPDATE SET
        owner_id = EXCLUDED.owner_id,
        name = EXCLUDED.name,
        format = EXCLUDED.format,
        visibility = EXCLUDED.visibility,
        slug = EXCLUDED.slug,
        public_slug = NULL,
        is_valid = true,
        background_name = EXCLUDED.background_name,
        sleeves_name = EXCLUDED.sleeves_name,
        folder_id = NULL,
        updated_at = NOW()
    RETURNING id
),
expected_deck_cards AS (
    SELECT
        substr(md5('commanderzone-load-test-deck-card-commander-' || load_users.n::text), 1, 8)
            || '-' || substr(md5('commanderzone-load-test-deck-card-commander-' || load_users.n::text), 9, 4)
            || '-' || substr(md5('commanderzone-load-test-deck-card-commander-' || load_users.n::text), 13, 4)
            || '-' || substr(md5('commanderzone-load-test-deck-card-commander-' || load_users.n::text), 17, 4)
            || '-' || substr(md5('commanderzone-load-test-deck-card-commander-' || load_users.n::text), 21, 12) AS id,
        load_users.deck_id,
        commander.id AS card_id,
        1 AS quantity,
        'commander' AS section,
        load_users.n
    FROM load_users
    CROSS JOIN upserted_cards commander
    WHERE commander.scryfall_id = '99999999-0000-0000-0000-000000000001'
    UNION ALL
    SELECT
        substr(md5('commanderzone-load-test-deck-card-main-' || load_users.n::text), 1, 8)
            || '-' || substr(md5('commanderzone-load-test-deck-card-main-' || load_users.n::text), 9, 4)
            || '-' || substr(md5('commanderzone-load-test-deck-card-main-' || load_users.n::text), 13, 4)
            || '-' || substr(md5('commanderzone-load-test-deck-card-main-' || load_users.n::text), 17, 4)
            || '-' || substr(md5('commanderzone-load-test-deck-card-main-' || load_users.n::text), 21, 12) AS id,
        load_users.deck_id,
        land.id AS card_id,
        99 AS quantity,
        'main' AS section,
        load_users.n
    FROM load_users
    CROSS JOIN upserted_cards land
    WHERE land.scryfall_id = '99999999-0000-0000-0000-000000000002'
),
removed_old_load_deck_cards AS (
    DELETE FROM deck_card
    WHERE deck_id IN (SELECT id FROM upserted_decks)
      AND id NOT IN (SELECT id FROM expected_deck_cards)
    RETURNING id
),
upserted_deck_cards AS (
    INSERT INTO deck_card (
        id,
        deck_id,
        card_id,
        quantity,
        section,
        updated_at
    )
    SELECT DISTINCT ON (id)
        id,
        deck_id,
        card_id,
        quantity,
        section,
        NOW()
    FROM expected_deck_cards
    ORDER BY id, section
    ON CONFLICT (id) DO UPDATE SET
        deck_id = EXCLUDED.deck_id,
        card_id = EXCLUDED.card_id,
        quantity = EXCLUDED.quantity,
        section = EXCLUDED.section,
        updated_at = NOW()
    RETURNING id
)
SELECT
    (SELECT count(*) FROM upserted_users) AS users_seeded,
    (SELECT count(*) FROM upserted_decks) AS private_decks_seeded,
    (SELECT count(*) FROM upserted_deck_cards) AS deck_card_rows_seeded;

INSERT INTO card_print (
    scryfall_id,
    oracle_id,
    normalized_name,
    set_code,
    collector_number,
    default_name,
    default_lang,
    default_set_name,
    default_mana_cost,
    default_type_line,
    default_oracle_text,
    default_image_uris,
    default_card_faces,
    layout,
    commander_legal,
    updated_at
)
SELECT DISTINCT ON (scryfall_id)
    scryfall_id,
    oracle_id,
    normalized_name,
    set_code,
    collector_number,
    name,
    COALESCE(lang, 'en'),
    set_name,
    mana_cost,
    type_line,
    oracle_text,
    image_uris,
    card_faces,
    layout,
    commander_legal,
    NOW()
FROM card
WHERE scryfall_id IN (
    '99999999-0000-0000-0000-000000000001',
    '99999999-0000-0000-0000-000000000002'
)
ORDER BY scryfall_id, updated_at DESC
ON CONFLICT (scryfall_id) DO UPDATE SET
    oracle_id = EXCLUDED.oracle_id,
    normalized_name = EXCLUDED.normalized_name,
    set_code = EXCLUDED.set_code,
    collector_number = EXCLUDED.collector_number,
    default_name = EXCLUDED.default_name,
    default_lang = EXCLUDED.default_lang,
    default_set_name = EXCLUDED.default_set_name,
    default_mana_cost = EXCLUDED.default_mana_cost,
    default_type_line = EXCLUDED.default_type_line,
    default_oracle_text = EXCLUDED.default_oracle_text,
    default_image_uris = EXCLUDED.default_image_uris,
    default_card_faces = EXCLUDED.default_card_faces,
    layout = EXCLUDED.layout,
    commander_legal = EXCLUDED.commander_legal,
    updated_at = NOW();

INSERT INTO card_print_locale (
    print_scryfall_id,
    lang,
    name,
    printed_name,
    mana_cost,
    type_line,
    oracle_text,
    set_name,
    image_uris,
    card_faces,
    image_status,
    updated_at
)
SELECT DISTINCT ON (scryfall_id, COALESCE(lang, 'en'))
    scryfall_id,
    COALESCE(lang, 'en'),
    name,
    printed_name,
    mana_cost,
    type_line,
    oracle_text,
    set_name,
    image_uris,
    card_faces,
    image_status,
    NOW()
FROM card
WHERE scryfall_id IN (
    '99999999-0000-0000-0000-000000000001',
    '99999999-0000-0000-0000-000000000002'
)
ORDER BY scryfall_id, COALESCE(lang, 'en'), updated_at DESC
ON CONFLICT (print_scryfall_id, lang) DO UPDATE SET
    name = EXCLUDED.name,
    printed_name = EXCLUDED.printed_name,
    mana_cost = EXCLUDED.mana_cost,
    type_line = EXCLUDED.type_line,
    oracle_text = EXCLUDED.oracle_text,
    set_name = EXCLUDED.set_name,
    image_uris = EXCLUDED.image_uris,
    card_faces = EXCLUDED.card_faces,
    image_status = EXCLUDED.image_status,
    updated_at = NOW();

-- Safety pass: ensure decks/cards exist from the persisted app_user rows.
-- This makes reruns repair users created by an older version of this script.
WITH params AS (
    SELECT
        1 AS first_index,
        500 AS user_count,
        'test'::text AS account_prefix,
        'test.com'::text AS email_domain
),
numbers AS (
    SELECT generate_series(first_index, first_index + user_count - 1) AS n
    FROM params
),
load_users AS (
    SELECT
        n,
        account_prefix || CASE WHEN n < 100 THEN lpad(n::text, 2, '0') ELSE n::text END AS username,
        account_prefix || CASE WHEN n < 100 THEN lpad(n::text, 2, '0') ELSE n::text END || '@' || email_domain AS email,
        substr(md5('commanderzone-load-test-deck-' || n::text), 1, 8)
            || '-' || substr(md5('commanderzone-load-test-deck-' || n::text), 9, 4)
            || '-' || substr(md5('commanderzone-load-test-deck-' || n::text), 13, 4)
            || '-' || substr(md5('commanderzone-load-test-deck-' || n::text), 17, 4)
            || '-' || substr(md5('commanderzone-load-test-deck-' || n::text), 21, 12) AS deck_id
    FROM numbers
    CROSS JOIN params
),
persisted_users AS (
    SELECT app_user.id, load_users.email, load_users.deck_id, load_users.n
    FROM load_users
    INNER JOIN app_user ON app_user.email = load_users.email
),
load_cards AS (
    SELECT id, scryfall_id
    FROM card
    WHERE scryfall_id IN (
        '99999999-0000-0000-0000-000000000001',
        '99999999-0000-0000-0000-000000000002'
    )
),
repaired_decks AS (
    INSERT INTO deck (
        id,
        owner_id,
        name,
        format,
        visibility,
        slug,
        public_slug,
        is_valid,
        background_name,
        sleeves_name,
        folder_id,
        created_at,
        updated_at
    )
    SELECT DISTINCT ON (persisted_users.deck_id)
        persisted_users.deck_id,
        persisted_users.id,
        'Load Test Deck',
        'commander',
        'private',
        'commanderzone-load-test-commander-load-test-deck-commander-' || right(replace(persisted_users.deck_id, '-', ''), 8),
        NULL,
        true,
        'free_0',
        'facedown_card',
        NULL,
        NOW(),
        NOW()
    FROM persisted_users
    ORDER BY persisted_users.deck_id, persisted_users.n
    ON CONFLICT (id) DO UPDATE SET
        owner_id = EXCLUDED.owner_id,
        name = EXCLUDED.name,
        format = EXCLUDED.format,
        visibility = EXCLUDED.visibility,
        slug = EXCLUDED.slug,
        public_slug = NULL,
        is_valid = true,
        background_name = EXCLUDED.background_name,
        sleeves_name = EXCLUDED.sleeves_name,
        folder_id = NULL,
        updated_at = NOW()
    RETURNING id
),
expected_deck_cards AS (
    SELECT
        substr(md5('commanderzone-load-test-deck-card-commander-' || persisted_users.n::text), 1, 8)
            || '-' || substr(md5('commanderzone-load-test-deck-card-commander-' || persisted_users.n::text), 9, 4)
            || '-' || substr(md5('commanderzone-load-test-deck-card-commander-' || persisted_users.n::text), 13, 4)
            || '-' || substr(md5('commanderzone-load-test-deck-card-commander-' || persisted_users.n::text), 17, 4)
            || '-' || substr(md5('commanderzone-load-test-deck-card-commander-' || persisted_users.n::text), 21, 12) AS id,
        persisted_users.deck_id,
        load_cards.id AS card_id,
        1 AS quantity,
        'commander' AS section
    FROM persisted_users
    CROSS JOIN load_cards
    WHERE load_cards.scryfall_id = '99999999-0000-0000-0000-000000000001'
    UNION ALL
    SELECT
        substr(md5('commanderzone-load-test-deck-card-main-' || persisted_users.n::text), 1, 8)
            || '-' || substr(md5('commanderzone-load-test-deck-card-main-' || persisted_users.n::text), 9, 4)
            || '-' || substr(md5('commanderzone-load-test-deck-card-main-' || persisted_users.n::text), 13, 4)
            || '-' || substr(md5('commanderzone-load-test-deck-card-main-' || persisted_users.n::text), 17, 4)
            || '-' || substr(md5('commanderzone-load-test-deck-card-main-' || persisted_users.n::text), 21, 12) AS id,
        persisted_users.deck_id,
        load_cards.id AS card_id,
        99 AS quantity,
        'main' AS section
    FROM persisted_users
    CROSS JOIN load_cards
    WHERE load_cards.scryfall_id = '99999999-0000-0000-0000-000000000002'
),
removed_old_load_deck_cards AS (
    DELETE FROM deck_card
    WHERE deck_id IN (SELECT id FROM repaired_decks)
      AND id NOT IN (SELECT id FROM expected_deck_cards)
    RETURNING id
),
repaired_deck_cards AS (
    INSERT INTO deck_card (
        id,
        deck_id,
        card_id,
        quantity,
        section,
        updated_at
    )
    SELECT DISTINCT ON (id)
        id,
        deck_id,
        card_id,
        quantity,
        section,
        NOW()
    FROM expected_deck_cards
    ORDER BY id, section
    ON CONFLICT (id) DO UPDATE SET
        deck_id = EXCLUDED.deck_id,
        card_id = EXCLUDED.card_id,
        quantity = EXCLUDED.quantity,
        section = EXCLUDED.section,
        updated_at = NOW()
    RETURNING id
)
SELECT
    (SELECT count(*) FROM persisted_users) AS persisted_load_users,
    (SELECT count(*) FROM repaired_decks) AS load_decks_repaired,
    (SELECT count(*) FROM repaired_deck_cards) AS load_deck_card_rows_repaired,
    (
        SELECT count(*)
        FROM deck
        INNER JOIN app_user ON app_user.id = deck.owner_id
        WHERE app_user.email ~ '^test[0-9]+@test\.com$'
          AND deck.name = 'Load Test Deck'
    ) AS actual_load_decks;

COMMIT;
