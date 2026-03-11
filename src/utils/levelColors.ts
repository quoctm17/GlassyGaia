/**
 * Get level badge colors matching level-framework-styles.css
 */

interface LevelColors {
  background: string;
  color: string;
}

// Palette of ~10 distinct colors (index 0 = easiest, higher index = harder)
const LEVEL_PALETTE: string[] = [
  "#CD55BF", // pink
  "#FF8FA3", // salmon
  "#5745DD", // indigo
  "#3B82F6", // blue
  "#22C55E", // green
  "#FACC15", // yellow
  "#F97316", // orange
  "#EA580C", // deep orange
  "#F97373", // light red
  "#DC2626", // red
];

const paletteColor = (index: number): LevelColors => {
  const safeIndex = Math.max(0, Math.min(LEVEL_PALETTE.length - 1, index));
  return { background: LEVEL_PALETTE[safeIndex], color: "#FFFFFF" };
};

const LEVEL_COLOR_MAP: Record<string, LevelColors> = {
  // CEFR levels (A1..C2) - map 6 levels across first 6 palette colors
  A1: paletteColor(0),
  A2: paletteColor(1),
  B1: paletteColor(2),
  B2: paletteColor(3),
  C1: paletteColor(4),
  C2: paletteColor(5),

  // JLPT levels (N5 easy -> N1 hard) spread across palette
  N5: paletteColor(0),
  N4: paletteColor(2),
  N3: paletteColor(4),
  N2: paletteColor(6),
  N1: paletteColor(8),

  // HSK numeric levels (1 easy -> 9 hard) mapped roughly 1→0 .. 9→8
  "1": paletteColor(0),
  "2": paletteColor(1),
  "3": paletteColor(2),
  "4": paletteColor(3),
  "5": paletteColor(4),
  "6": paletteColor(5),
  "7": paletteColor(6),
  "8": paletteColor(7),
  "9": paletteColor(8),

  // HSK with prefix
  "HSK 1": paletteColor(0),
  "HSK 2": paletteColor(1),
  "HSK 3": paletteColor(2),
  "HSK 4": paletteColor(3),
  "HSK 5": paletteColor(4),
  "HSK 6": paletteColor(5),
  "HSK 7": paletteColor(6),
  "HSK 8": paletteColor(7),
  "HSK 9": paletteColor(8),
};

const DEFAULT_COLOR: LevelColors = {
  background: '#94a3b8',
  color: '#1e293b'
};

export function getLevelBadgeColors(level: string): LevelColors {
  const normalized = level.toUpperCase().trim();
  return LEVEL_COLOR_MAP[normalized] || DEFAULT_COLOR;
}
