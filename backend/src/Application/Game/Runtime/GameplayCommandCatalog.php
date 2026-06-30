<?php

namespace App\Application\Game\Runtime;

final class GameplayCommandCatalog
{
    /**
     * @var array<string,string>
     */
    private const ALIASES = [
        'zone.changed' => 'zone.reorderedByIds',
        'mulligan.scry_confirm' => 'mulligan.scry.confirm',
    ];

    /**
     * @var list<string>
     */
    private const FINAL_RUNTIME_COMMANDS = [
        'life.changed',
        'turn.changed',
        'dice.rolled',
        'card.tapped',
        'card.face_down.changed',
        'card.revealed',
        'card.controller.changed',
        'cards.position.changed',
        'card.counter.changed',
        'counter.changed',
        'commander.damage.changed',
        'card.power_toughness.changed',
        'card.position.changed',
        'library.draw',
        'library.draw_many',
        'library.reveal_top',
        'library.reveal',
        'library.play_top_revealed',
        'library.reorder_top',
        'library.move_top',
        'library.put_top',
        'library.put_bottom',
        'library.view',
        'library.shuffle',
        'card.token.created',
        'card.token_copy.created',
        'zone.random_card.selected',
        'card.dungeon_marker.changed',
        'card.face.changed',
        'card.moved',
        'cards.moved',
        'zone.reorderedByIds',
        'zone.move_all',
        'battlefield.untap_all',
        'stack.card_added',
        'stack.item_removed',
        'arrow.created',
        'arrow.removed',
        'attachment.created',
        'attachment.removed',
        'helper.created',
        'helper.updated',
        'helper.removed',
        'game.concede',
        'game.close',
        'mulligan.take',
        'mulligan.keep',
        'mulligan.cards_bottomed',
        'mulligan.scry.confirm',
        'mulligan.ready',
        'mulligan.completed',
        'game.phase.set',
    ];

    /**
     * @var list<string>
     */
    private const CLIENT_RUNTIME_COMMANDS = [
        'life.changed',
        'turn.changed',
        'dice.rolled',
        'card.tapped',
        'card.face_down.changed',
        'card.revealed',
        'card.controller.changed',
        'cards.position.changed',
        'card.counter.changed',
        'counter.changed',
        'commander.damage.changed',
        'card.power_toughness.changed',
        'card.position.changed',
        'library.draw',
        'library.draw_many',
        'library.reveal_top',
        'library.reveal',
        'library.play_top_revealed',
        'library.reorder_top',
        'library.move_top',
        'library.put_top',
        'library.put_bottom',
        'library.view',
        'library.shuffle',
        'card.token.created',
        'card.token_copy.created',
        'zone.random_card.selected',
        'card.dungeon_marker.changed',
        'card.face.changed',
        'card.moved',
        'cards.moved',
        'zone.reorderedByIds',
        'zone.move_all',
        'battlefield.untap_all',
        'stack.card_added',
        'stack.item_removed',
        'arrow.created',
        'arrow.removed',
        'attachment.created',
        'attachment.removed',
        'helper.created',
        'helper.updated',
        'helper.removed',
        'game.concede',
        'game.close',
        'mulligan.take',
        'mulligan.keep',
        'mulligan.scry.confirm',
    ];

    /**
     * @var list<string>
     */
    private const INTERNAL_RUNTIME_COMMANDS = [
        'mulligan.cards_bottomed',
        'mulligan.ready',
        'mulligan.completed',
        'game.phase.set',
    ];

    /**
     * @var array<string,string>
     */
    private const EXPLICIT_NON_RUNTIME = [
        'chat.message' => 'chat streams are handled outside the gameplay actor',
        'chat.reaction.toggled' => 'chat streams are handled outside the gameplay actor',
        'disconnect.vote' => 'disconnect vote orchestration is handled outside the gameplay actor',
    ];

    public static function canonicalType(string $type): string
    {
        return self::ALIASES[$type] ?? $type;
    }

    /**
     * @return array<string,string>
     */
    public static function aliases(): array
    {
        return self::ALIASES;
    }

    /**
     * @return list<string>
     */
    public static function finalRuntimeCommands(): array
    {
        return self::FINAL_RUNTIME_COMMANDS;
    }

    /**
     * @return list<string>
     */
    public static function clientRuntimeCommands(): array
    {
        return self::CLIENT_RUNTIME_COMMANDS;
    }

    /**
     * @return list<string>
     */
    public static function internalRuntimeCommands(): array
    {
        return self::INTERNAL_RUNTIME_COMMANDS;
    }

    public static function internalRuntimeCommand(string $type): bool
    {
        return in_array(self::canonicalType($type), self::INTERNAL_RUNTIME_COMMANDS, true);
    }

    public static function explicitlyNonRuntime(string $type): bool
    {
        return isset(self::EXPLICIT_NON_RUNTIME[self::canonicalType($type)]);
    }
}
