export interface DiceRollCommand {
  readonly kind: string;
}

export interface DiceRollResult {
  readonly kind: string;
  readonly finalResult: string;
}
