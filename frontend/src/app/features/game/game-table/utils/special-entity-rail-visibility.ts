import { GameSpecialEntity } from '../../../../core/models/game.model';

const SPECIAL_ENTITY_RAIL_TEMPLATES = new Set<GameSpecialEntity['template']>([
  'monarch',
  'initiative',
  'citys_blessing',
]);

export function isSpecialEntityRailVisible(entity: Pick<GameSpecialEntity, 'template'>): boolean {
  return SPECIAL_ENTITY_RAIL_TEMPLATES.has(entity.template);
}

export function visibleSpecialEntityRailEntities(entities: readonly GameSpecialEntity[]): readonly GameSpecialEntity[] {
  return entities.filter(isSpecialEntityRailVisible);
}
