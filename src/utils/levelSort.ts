/**
 * Sort difficulty levels from easy to hard
 * Supports CEFR (A1, A2, B1, B2, C1, C2), JLPT (N5, N4, N3, N2, N1), HSK (1-9), TOPIK (1-6), and other frameworks
 */

const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const JLPT_ORDER = ['N5', 'N4', 'N3', 'N2', 'N1'];
const TOPIK_ORDER = ['1', '2', '3', '4', '5', '6'];

export function sortLevelsByDifficulty(levels: Record<string, number>): [string, number][] {
  const entries = Object.entries(levels);
  
  return entries.sort(([a], [b]) => {
    // Normalize to uppercase for comparison
    const aUpper = a.toUpperCase();
    const bUpper = b.toUpperCase();
    
    // Check if both are CEFR levels
    const aInCEFR = CEFR_ORDER.indexOf(aUpper);
    const bInCEFR = CEFR_ORDER.indexOf(bUpper);
    if (aInCEFR !== -1 && bInCEFR !== -1) {
      return aInCEFR - bInCEFR;
    }
    
    // Check if both are JLPT levels
    const aInJLPT = JLPT_ORDER.indexOf(aUpper);
    const bInJLPT = JLPT_ORDER.indexOf(bUpper);
    if (aInJLPT !== -1 && bInJLPT !== -1) {
      return aInJLPT - bInJLPT;
    }
    
    // Check if both are HSK levels (numeric or "HSK 1", "HSK 2", etc.)
    const aHSK = extractHSKNumber(aUpper);
    const bHSK = extractHSKNumber(bUpper);
    if (aHSK !== null && bHSK !== null) {
      return aHSK - bHSK;
    }
    
    // Check if both are TOPIK levels (numeric 1-6)
    const aTOPIK = extractTOPIKNumber(aUpper);
    const bTOPIK = extractTOPIKNumber(bUpper);
    if (aTOPIK !== null && bTOPIK !== null) {
      return aTOPIK - bTOPIK;
    }
    
    // Check if both are pure numbers (for numeric level systems)
    const aNum = parseFloat(a);
    const bNum = parseFloat(b);
    if (!isNaN(aNum) && !isNaN(bNum)) {
      return aNum - bNum;
    }
    
    // Fallback: alphabetical sort
    return a.localeCompare(b);
  });
}

function extractHSKNumber(level: string): number | null {
  // Match patterns like "HSK 1", "HSK1", "1", etc.
  const match = level.match(/HSK\s*(\d+)|^(\d+)$/);
  if (match) {
    const num = parseInt(match[1] || match[2]);
    if (!isNaN(num) && num >= 1 && num <= 9) {
      return num;
    }
  }
  return null;
}

function extractTOPIKNumber(level: string): number | null {
  // Match patterns like "TOPIK 1", "TOPIK1", "1", etc.
  const match = level.match(/TOPIK\s*(\d+)|^(\d+)$/);
  if (match) {
    const num = parseInt(match[1] || match[2]);
    if (!isNaN(num) && num >= 1 && num <= 6) {
      return num;
    }
  }
  return null;
}
