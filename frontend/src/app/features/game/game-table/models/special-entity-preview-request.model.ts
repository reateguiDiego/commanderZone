import { GameSpecialEntity } from '../../../../core/models/game.model';
import { CardPreviewSourceRect } from './card-preview.model';

export interface SpecialEntityPreviewRequest {
  readonly entity: GameSpecialEntity;
  readonly sourceRect: CardPreviewSourceRect | null;
}
