export interface OnboardingStep {
  id: 'import' | 'room' | 'share' | 'play';
  number: number;
  title: string;
  description: string;
  state: 'upcoming' | 'active' | 'complete';
}
