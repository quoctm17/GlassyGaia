// SRS State constants
export const SRS_STATES = {
  NONE: 'none',
  NEW: 'new',
  AGAIN: 'again',
  HARD: 'hard',
  GOOD: 'good',
  EASY: 'easy',
} as const;

export type SRSState = typeof SRS_STATES[keyof typeof SRS_STATES];

// SRS states that can be selected in dropdown (excluding 'none')
export const SELECTABLE_SRS_STATES: SRSState[] = [
  SRS_STATES.NEW,
  SRS_STATES.AGAIN,
  SRS_STATES.HARD,
  SRS_STATES.GOOD,
  SRS_STATES.EASY,
];

// SRS state labels for display
export const SRS_STATE_LABELS: Record<SRSState, string> = {
  [SRS_STATES.NONE]: 'None',
  [SRS_STATES.NEW]: 'New',
  [SRS_STATES.AGAIN]: 'Again',
  [SRS_STATES.HARD]: 'Hard',
  [SRS_STATES.GOOD]: 'Good',
  [SRS_STATES.EASY]: 'Easy',
};

