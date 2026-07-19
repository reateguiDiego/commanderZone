import { GameCommandType, GameZoneName } from '../../../../core/models/game.model';

export type SelectionActionId =
  | 'move:battlefield'
  | 'move:hand'
  | 'move:graveyard'
  | 'move:exile'
  | 'move:library'
  | 'tap'
  | 'untap'
  | 'faceDown'
  | 'faceUp'
  | 'createStack'
  | 'dissolveStack'
  | 'detach';

export interface SelectionActionAvailability {
  readonly actionId: SelectionActionId;
  readonly enabled: boolean;
  readonly visible: boolean;
  readonly reasonDisabled: string | null;
  readonly requiresConfirmation: boolean;
  readonly supportsBatch: boolean;
  readonly affectedCount: number;
  readonly resolvesGroupMembers: boolean;
  readonly destinationOptions: readonly GameZoneName[];
  readonly privacyImpact: 'none' | 'conceal' | 'materialize';
  readonly commandType: GameCommandType;
  readonly labelKey: string;
  readonly category: 'movement' | 'battlefield' | 'relations';
}

export interface SelectionActionConfirmation {
  readonly action: SelectionActionAvailability;
  readonly messageKey: string;
}
