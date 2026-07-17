<?php

namespace App\Application\Game;

final class GameLogPrivacySanitizer
{
    private const SENSITIVE_KEYS = [
        'instanceid', 'instanceids', 'orderedinstanceids', 'cardinstanceid', 'cardinstanceids',
        'sourceinstanceid', 'sourcecardinstanceid', 'commanderinstanceid',
        'cardkey', 'cardref', 'printid', 'name', 'imageuris', 'cardfaces',
        'loc', 'staticbundle',
    ];

    /**
     * @param array<string,mixed> $entry
     *
     * @return array<string,mixed>
     */
    public function sanitizePublicEntry(array $entry, bool $force = false): array
    {
        if (!$force && !$this->requiresRedaction($entry)) {
            return $entry;
        }

        $entry = $this->redactMap($entry, true);
        $entry['visibility'] = 'public';
        $type = is_string($entry['type'] ?? null) ? $entry['type'] : '';
        if (!in_array($type, [
            'card.moved',
            'cards.moved',
            'library.selection.move',
            'library.top.play_face_down',
            'hand.cards.reveal',
            'hand.cards.revoke',
        ], true)) {
            unset($entry['i18nKey']);
            $entry['message'] = 'Updated a hidden card.';
        }

        return $entry;
    }

    /** @param array<string,mixed> $entry */
    private function requiresRedaction(array $entry): bool
    {
        $params = is_array($entry['params'] ?? null) ? $entry['params'] : [];
        if (($params['faceDown'] ?? false) === true || in_array((string) ($entry['cardZone'] ?? ''), ['hand', 'library'], true)) {
            return true;
        }

        $cards = is_array($entry['refs']['cards'] ?? null) ? $entry['refs']['cards'] : [];
        foreach ($cards as $ref) {
            if (!is_array($ref) || ($ref['visibility'] ?? null) !== 'public') {
                return true;
            }
        }

        // A public card identity is safe only when accompanied by an explicit
        // public card reference. Legacy bare IDs therefore fail closed.
        if ($this->containsSensitiveIdentity($entry) && $cards === []) {
            return true;
        }

        return false;
    }

    /**
     * @param array<string,mixed> $value
     *
     * @return array<string,mixed>
     */
    private function redactMap(array $value, bool $topLevel): array
    {
        foreach (array_keys($value) as $key) {
            $lower = strtolower((string) $key);
            if (in_array($lower, self::SENSITIVE_KEYS, true)
                || ($topLevel && in_array($lower, ['cardnames', 'cardplayerid', 'cardzone'], true))) {
                unset($value[$key]);

                continue;
            }

            if ($lower === 'refs' && is_array($value[$key])) {
                unset($value[$key]['cards']);
                $value[$key] = $this->redactMap($value[$key], false);
                if ($value[$key] === []) {
                    unset($value[$key]);
                }

                continue;
            }

            if (is_array($value[$key])) {
                $value[$key] = $this->redactArray($value[$key]);
            }
        }

        return $value;
    }

    /** @param array<mixed> $value */
    private function redactArray(array $value): array
    {
        if (!array_is_list($value)) {
            /** @var array<string,mixed> $value */
            return $this->redactMap($value, false);
        }

        foreach ($value as $index => $item) {
            if (is_array($item)) {
                $value[$index] = $this->redactArray($item);
            }
        }

        return $value;
    }

    /** @param array<string,mixed> $entry */
    private function containsSensitiveIdentity(array $entry): bool
    {
        foreach ($entry as $key => $value) {
            if (in_array(strtolower((string) $key), self::SENSITIVE_KEYS, true)) {
                return true;
            }
            if (is_array($value) && $this->containsSensitiveIdentity($value)) {
                return true;
            }
        }

        return false;
    }
}
