// Language to Framework mapping for level assessment
// Maps canonical language codes to their corresponding assessment frameworks

import type { CanonicalLang } from './lang';
import { canonicalizeLangCode } from './lang';

export type Framework = 'CEFR' | 'JLPT' | 'HSK' | 'TOPIK' | 'DELF' | 'DELE' | 'Goethe' | 'TestDaF';

/**
 * Maps a language code to its corresponding assessment framework
 * @param language - Language code (can be any format, will be canonicalized)
 * @returns Framework code or null if no mapping exists
 */
export function getFrameworkFromLanguage(language: string | null | undefined): Framework | null {
  if (!language) return null;
  
  const canon = canonicalizeLangCode(language);
  if (!canon) return null;
  
  // English -> CEFR
  if (canon === 'en') return 'CEFR';
  
  // Japanese -> JLPT
  if (canon === 'ja') return 'JLPT';
  
  // Chinese (Simplified/Traditional) -> HSK
  if (canon === 'zh' || canon === 'zh_trad' || canon === 'yue') return 'HSK';
  
  // Korean -> TOPIK
  if (canon === 'ko') return 'TOPIK';
  
  // French -> DELF
  if (canon === 'fr' || canon === 'fr_ca') return 'DELF';
  
  // Spanish -> DELE
  if (canon === 'es' || canon === 'es_la' || canon === 'es_es') return 'DELE';
  
  // German -> Goethe / TestDaF (default to Goethe)
  if (canon === 'de') return 'Goethe';
  
  // Default: CEFR for other European languages
  // This is a reasonable default as CEFR is widely used
  const europeanLangs: CanonicalLang[] = [
    'it', 'pt', 'pt_br', 'pt_pt', 'nl', 'pl', 'ro', 'ru', 'sv', 'tr', 'uk',
    'cs', 'da', 'fi', 'hu', 'no', 'nb', 'sk', 'sl', 'bg', 'hr', 'sr', 'bs',
    'el', 'he', 'ar', 'fa', 'ur', 'hi', 'bn', 'ta', 'te', 'ml', 'mr'
  ];
  if (europeanLangs.includes(canon as CanonicalLang)) {
    return 'CEFR';
  }
  
  // No mapping found
  return null;
}

/**
 * Get all supported frameworks
 */
export function getSupportedFrameworks(): Framework[] {
  return ['CEFR', 'JLPT', 'HSK', 'TOPIK', 'DELF', 'DELE', 'Goethe', 'TestDaF'];
}

/**
 * Get framework display name
 */
export function getFrameworkDisplayName(framework: Framework): string {
  const names: Record<Framework, string> = {
    CEFR: 'CEFR (Common European Framework)',
    JLPT: 'JLPT (Japanese-Language Proficiency Test)',
    HSK: 'HSK (Hanyu Shuiping Kaoshi)',
    TOPIK: 'TOPIK (Test of Proficiency in Korean)',
    DELF: 'DELF (Diplôme d\'études en langue française)',
    DELE: 'DELE (Diplomas de Español como Lengua Extranjera)',
    Goethe: 'Goethe-Zertifikat',
    TestDaF: 'TestDaF (Test Deutsch als Fremdsprache)'
  };
  return names[framework] || framework;
}

/**
 * Get framework levels
 */
export function getFrameworkLevels(framework: Framework): string[] {
  const levels: Record<Framework, string[]> = {
    CEFR: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
    JLPT: ['N5', 'N4', 'N3', 'N2', 'N1'],
    HSK: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
    TOPIK: ['1', '2', '3', '4', '5', '6'],
    DELF: ['A1', 'A2', 'B1', 'B2'],
    DELE: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
    Goethe: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
    TestDaF: ['TDN3', 'TDN4', 'TDN5']
  };
  return levels[framework] || [];
}

