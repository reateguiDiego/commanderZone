export type OpponentTargetingDirection = 'incoming' | 'outgoing';

export interface OpponentTargetingPill {
  readonly direction: OpponentTargetingDirection;
  readonly text: string;
  readonly title: string;
}
