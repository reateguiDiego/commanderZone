<?php

namespace App\Application\Deck;

use Doctrine\DBAL\Connection;
use Doctrine\DBAL\ParameterType;
use Symfony\Component\Uid\Uuid;

final class AnalysisRuleSeeder
{
    private const FORMAT_COMMANDER = 'commander';

    public function __construct(
        private readonly Connection $connection,
        private readonly ?DeckAnalysisDataVersionProvider $versionProvider = null,
    ) {
    }

    /**
     * @return array{seen:int,inserted:int,updated:int}
     */
    public function seed(): array
    {
        return $this->connection->transactional(function (): array {
            $result = [
                'seen' => 0,
                'inserted' => 0,
                'updated' => 0,
            ];

            foreach ($this->rules() as $rule) {
                ++$result['seen'];
                $status = $this->upsertRule($rule);
                if ($status === 'inserted') {
                    ++$result['inserted'];
                    continue;
                }

                if ($status === 'updated') {
                    ++$result['updated'];
                }
            }

            if ($result['inserted'] > 0 || $result['updated'] > 0) {
                $this->versionProvider?->touchRules();
            }

            return $result;
        });
    }

    /**
     * @param array{
     *     format:string,
     *     archetype:?string,
     *     power_band:?string,
     *     metric:string,
     *     min_recommended:?string,
     *     max_recommended:?string,
     *     severity:string,
     *     message_key:string,
     *     active:bool
     * } $rule
     */
    private function upsertRule(array $rule): string
    {
        $exists = $this->ruleExisted($rule);
        $this->connection->executeStatement(
            <<<'SQL'
INSERT INTO analysis_rule (
    id,
    format,
    archetype,
    power_band,
    metric,
    min_recommended,
    max_recommended,
    severity,
    message_key,
    active,
    updated_at
) VALUES (
    :id,
    :format,
    :archetype,
    :power_band,
    :metric,
    :min_recommended,
    :max_recommended,
    :severity,
    :message_key,
    :active,
    NOW()
)
ON CONFLICT (format, (COALESCE(archetype, '')), (COALESCE(power_band, '')), metric, message_key) DO UPDATE SET
    min_recommended = EXCLUDED.min_recommended,
    max_recommended = EXCLUDED.max_recommended,
    severity = EXCLUDED.severity,
    active = EXCLUDED.active,
    updated_at = NOW()
SQL,
            [
                ...$rule,
                'id' => Uuid::v7()->toRfc4122(),
            ],
            ['active' => ParameterType::BOOLEAN],
        );

        return $exists ? 'updated' : 'inserted';
    }

    /**
     * @param array{format:string,archetype:?string,power_band:?string,metric:string,message_key:string} $rule
     */
    private function ruleExisted(array $rule): bool
    {
        return (bool) $this->connection->fetchOne(
            <<<'SQL'
SELECT 1
FROM analysis_rule
WHERE format = :format
  AND COALESCE(archetype, '') = COALESCE(:archetype, '')
  AND COALESCE(power_band, '') = COALESCE(:power_band, '')
  AND metric = :metric
  AND message_key = :message_key
LIMIT 1
SQL,
            [
                'format' => $rule['format'],
                'archetype' => $rule['archetype'],
                'power_band' => $rule['power_band'],
                'metric' => $rule['metric'],
                'message_key' => $rule['message_key'],
            ],
        );
    }

    /**
     * @return list<array{
     *     format:string,
     *     archetype:?string,
     *     power_band:?string,
     *     metric:string,
     *     min_recommended:?string,
     *     max_recommended:?string,
     *     severity:string,
     *     message_key:string,
     *     active:bool
     * }>
     */
    private function rules(): array
    {
        return [
            $this->rule(null, 'lands', '34', '38', 'warning'),
            $this->rule(null, 'ramp', '8', null, 'warning'),
            $this->rule(null, 'draw', '8', null, 'warning'),
            $this->rule(null, 'spot_removal', '6', null, 'warning'),
            $this->rule(null, 'board_wipe', '2', null, 'warning'),
            $this->rule(null, 'protection', '2', null, 'warning'),
            $this->rule(null, 'wincon', '2', null, 'warning'),
            $this->rule(null, 'graveyard_hate', '1', null, 'info'),
            $this->rule(null, 'tutor', '0', null, 'info'),
            $this->rule('voltron', 'protection', '5', null, 'warning'),
            $this->rule('voltron', 'combat_finisher', '2', null, 'warning'),
            $this->rule('combo', 'tutor', '4', null, 'warning'),
            $this->rule('combo', 'protection', '3', null, 'warning'),
            $this->rule('control', 'interaction_total', '10', null, 'warning'),
            $this->rule('control', 'board_wipe', '3', null, 'warning'),
            $this->rule('aristocrats', 'sacrifice_outlet', '4', null, 'warning'),
            $this->rule('aristocrats', 'payoff', '4', null, 'warning'),
            $this->rule('aristocrats', 'token_maker', '4', null, 'info'),
            $this->rule('reanimator', 'reanimation', '5', null, 'warning'),
            $this->rule('reanimator', 'graveyard_targets', '6', null, 'warning'),
            $this->rule('reanimator', 'discard_outlets', '3', null, 'warning'),
            $this->rule('tokens', 'token_maker', '8', null, 'warning'),
            $this->rule('tokens', 'payoff', '3', null, 'warning'),
            $this->rule('spellslinger', 'instant_sorcery_density', '20', null, 'warning'),
            $this->rule('spellslinger', 'cost_reducer', '2', null, 'info'),
            $this->rule('stax', 'stax', '5', null, 'warning'),
            $this->rule('stax', 'protection', '3', null, 'info'),
        ];
    }

    /**
     * @return array{
     *     format:string,
     *     archetype:?string,
     *     power_band:?string,
     *     metric:string,
     *     min_recommended:?string,
     *     max_recommended:?string,
     *     severity:string,
     *     message_key:string,
     *     active:bool
     * }
     */
    private function rule(?string $archetype, string $metric, ?string $minRecommended, ?string $maxRecommended, string $severity): array
    {
        return [
            'format' => self::FORMAT_COMMANDER,
            'archetype' => $archetype,
            'power_band' => null,
            'metric' => $metric,
            'min_recommended' => $minRecommended,
            'max_recommended' => $maxRecommended,
            'severity' => $severity,
            'message_key' => $archetype === null
                ? sprintf('deck_analysis.commander.generic.%s', $metric)
                : sprintf('deck_analysis.commander.%s.%s', $archetype, $metric),
            'active' => true,
        ];
    }
}
