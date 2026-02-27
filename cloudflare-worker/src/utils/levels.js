// Global constant defined outside the function to ensure it's initialized only once in memory.
export const LEVEL_MAPS = {
  'CEFR': { 'A1': 0, 'A2': 1, 'B1': 2, 'B2': 3, 'C1': 4, 'C2': 5 },
  'JLPT': { 'N5': 0, 'N4': 1, 'N3': 2, 'N2': 3, 'N1': 4 },
  'HSK':  { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6, '8': 7, '9': 8 }
};

// Get framework from main language
export function getFrameworkFromLanguage(language) {
  if (!language) return 'CEFR';
  const langLower = String(language || '').toLowerCase();
  if (langLower === 'ja' || langLower === 'japanese') return 'JLPT';
  if (langLower.startsWith('zh') || langLower === 'chinese') return 'HSK';
  return 'CEFR'; // Default to CEFR for English and other languages
}

// Map level to numeric index for range filtering
export function getLevelIndex(level, language) {
  // Input Validation: Both level and language are mandatory for accurate mapping.
  if (!level || !language) return -1;

  // Identify the Framework based on language input.
  const framework = getFrameworkFromLanguage(language);
  const map = LEVEL_MAPS[framework];
  if (!map) return -1;

  // We convert to string to handle both number 1 and string "1"
  const normalizedLevel = String(level).trim().toUpperCase();
  
  // This lookup is still O(1) and safe because 'map' is already 
  // narrowed down to the specific framework.
  return map[normalizedLevel] ?? -1;
}

/**
 * Compare two levels within the same framework.
 * Returns: -1 if level1 < level2, 0 if equal, 1 if level1 > level2.
 */
export function compareLevels(level1, level2, framework) {
  const map = LEVEL_MAPS[framework];
  if (!map) return 0; //prevent "cannot read property of undefined"

  // 2. Logic handling: Use numeric strings for HSK, uppercase for others & Get indices
  const format = (lvl) => (framework === 'HSK' ? String(lvl) : String(lvl).toUpperCase());
  const idx1 = map[format(level1)] ?? -1;
  const idx2 = map[format(level2)] ?? -1;

  // 4. Handle "Cannot Compare" vs "Equal"
  // If either level is not found in the framework, we return 0 (cannot compare)
  if (idx1 === -1 || idx2 === -1) return 0;

  // 5. Final Comparison: Use Math.sign to ensure the result is exactly {-1, 0, 1}
  // This solves the issue where (0 - 4) returned -4.
  return Math.sign(idx1 - idx2);
}

/**
 * Build level stats from rows of {framework, language, level}
 * Used by items calc-stats and admin assess-content-level endpoints
 */
export function buildLevelStats(rows) {
  const groups = new Map(); // key = framework||'' + '|' + language||''
  for (const r of rows) {
    const framework = r.framework || null;
    const language = r.language || null;
    const level = r.level || null;
    if (!framework || !level) continue;
    const key = `${framework}|${language || ''}`;
    let g = groups.get(key);
    if (!g) { g = { framework, language, counts: new Map(), total: 0 }; groups.set(key, g); }
    g.total += 1;
    g.counts.set(level, (g.counts.get(level) || 0) + 1);
  }
  const out = [];
  for (const g of groups.values()) {
    const levels = {};
    for (const [level, count] of g.counts.entries()) {
      const pct = g.total ? Math.round((count / g.total) * 1000) / 10 : 0; // one decimal
      levels[level] = pct;
    }
    out.push({ framework: g.framework, language: g.language, levels });
  }
  return out;
}
