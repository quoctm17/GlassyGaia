/**
 * Get level badge colors matching level-framework-styles.css
 */

interface LevelColors {
  background: string;
  color: string;
}

const LEVEL_COLOR_MAP: Record<string, LevelColors> = {
  // CEFR levels
  'A1': { background: '#86efac', color: '#065f46' },
  'A2': { background: '#7dd3fc', color: '#0c4a6e' },
  'B1': { background: '#fde047', color: '#713f12' },
  'B2': { background: '#f7a45e', color: '#7c2d12' },
  'C1': { background: '#fb923c', color: '#7c2d12' },
  'C2': { background: '#f87171', color: '#7f1d1d' },
  
  // JLPT levels
  'N5': { background: '#86efac', color: '#065f46' },
  'N4': { background: '#7dd3fc', color: '#0c4a6e' },
  'N3': { background: '#fde047', color: '#713f12' },
  'N2': { background: '#fb923c', color: '#7c2d12' },
  'N1': { background: '#f87171', color: '#7f1d1d' },
  
  // HSK levels
  '1': { background: '#86efac', color: '#065f46' },
  '2': { background: '#7dd3fc', color: '#0c4a6e' },
  '3': { background: '#bfdbfe', color: '#1e3a8a' },
  '4': { background: '#fde047', color: '#713f12' },
  '5': { background: '#fcd34d', color: '#78350f' },
  '6': { background: '#f7a45e', color: '#7c2d12' },
  '7': { background: '#fb923c', color: '#7c2d12' },
  '8': { background: '#fca5a5', color: '#7f1d1d' },
  '9': { background: '#f87171', color: '#7f1d1d' },
  
  // HSK with prefix
  'HSK 1': { background: '#86efac', color: '#065f46' },
  'HSK 2': { background: '#7dd3fc', color: '#0c4a6e' },
  'HSK 3': { background: '#bfdbfe', color: '#1e3a8a' },
  'HSK 4': { background: '#fde047', color: '#713f12' },
  'HSK 5': { background: '#fcd34d', color: '#78350f' },
  'HSK 6': { background: '#f7a45e', color: '#7c2d12' },
  'HSK 7': { background: '#fb923c', color: '#7c2d12' },
  'HSK 8': { background: '#fca5a5', color: '#7f1d1d' },
  'HSK 9': { background: '#f87171', color: '#7f1d1d' },
};

const DEFAULT_COLOR: LevelColors = {
  background: '#94a3b8',
  color: '#1e293b'
};

export function getLevelBadgeColors(level: string): LevelColors {
  const normalized = level.toUpperCase().trim();
  return LEVEL_COLOR_MAP[normalized] || DEFAULT_COLOR;
}
