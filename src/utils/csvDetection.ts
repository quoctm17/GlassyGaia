/**
 * Shared CSV language detection utilities for admin pages
 */
import { expandCanonicalToAliases } from './lang';

// Reserved columns: these are CSV metadata/structural columns, NOT language codes
export const RESERVED_COLUMNS = new Set([
  "id", "card_id", "cardid", "card id",
  "no", "number", "card_number", "cardnumber", "card number",
  "start", "start_time", "starttime", "start time", "start_time_ms",
  "end", "end_time", "endtime", "end time", "end_time_ms",
  "duration", "length", "card_length",
  "type", "card_type", "cardtype", "card type",
  "sentence", "text", "content",
  "image", "image_url", "imageurl", "image url", "image_key",
  "audio", "audio_url", "audiourl", "audio url", "audio_key",
  "difficulty", "difficulty_score", "difficultyscore", "difficulty score",
  "cefr", "cefr_level", "cefr level",
  "jlpt", "jlpt_level", "jlpt level",
  "hsk", "hsk_level", "hsk level",
  "notes", "tags", "metadata",
  "hiragana", "katakana", "romaji"
]);

export const AMBIGUOUS_COLS = new Set(["id", "in", "no"]); // Could be Indonesian/Norwegian OR reserved columns

export const SUPPORTED_CANON = [
  "ar","eu","bn","yue","ca","zh","zh_trad","hr","cs","da","nl","en","fil","fi",
  "fr","fr_ca","gl","de","el","he","hi","hu","is","id","it","ja","ko","ms","ml",
  "no","nb","pl","pt_br","pt_pt","ro","ru","es_la","es_es","sv","se","ta","te",
  "th","tr","uk","vi","lv","fa","ku","ckb","kmr","sdh","sl","sr","bg","ur","sq","lt",
  "kk","sk","uz","be","bs","mr","mn","et","hy"
] as const;

// Language alias map
export function buildLangAliasMap(): Record<string, string> {
  const aliasMap: Record<string, string> = {};
  SUPPORTED_CANON.forEach(c => {
    expandCanonicalToAliases(c).forEach(a => {
      aliasMap[a.toLowerCase()] = c;
    });
  });
  
  // Add base language codes that should map to their canonical variants
  // These are 2-letter ISO codes that users might use directly
  aliasMap["es"] = "es_es"; // Spanish → Spanish (Spain) by default
  aliasMap["pt"] = "pt_pt"; // Portuguese → Portuguese (Portugal) by default
  aliasMap["en"] = "en"; // English
  aliasMap["english"] = "en"; // English (full name)
  
  // Common misspellings / fallbacks
  aliasMap["portugese"] = "pt_pt";
  aliasMap["portugese (portugal)"] = "pt_pt";
  aliasMap["portugese (brazil)"] = "pt_br";
  aliasMap["nb"] = "nb";
  aliasMap["norwegian bokmal"] = "nb";
  aliasMap["norwegian bokmål"] = "nb";
  aliasMap["bokmal"] = "nb";
  aliasMap["bokmål"] = "nb";
  aliasMap["northern sami"] = "se";
  aliasMap["sami (northern)"] = "se";
  aliasMap["sami"] = "se";
  aliasMap["se"] = "se";
  aliasMap["sme"] = "se";
  aliasMap["bulgarian"] = "bg";
  aliasMap["bg"] = "bg";
  
  // Explicit variant forms with parentheses
  aliasMap["spanish (latin america)"] = "es_la";
  aliasMap["spanish (spain)"] = "es_es";
  aliasMap["portuguese (brazil)"] = "pt_br";
  aliasMap["portuguese (portugal)"] = "pt_pt";
  aliasMap["chinese (traditional)"] = "zh_trad";
  aliasMap["chinese (simplified)"] = "zh";
  aliasMap["french (canada)"] = "fr_ca";
  
  return aliasMap;
}

/**
 * Detect subtitle language headers from CSV headers
 * @param headers - CSV column headers
 * @param confirmedAsLanguage - Set of headers user confirmed as language (e.g., 'id' → Indonesian)
 * @returns Set of recognized subtitle headers
 */
export function detectSubtitleHeaders(
  headers: string[],
  confirmedAsLanguage: Set<string>
): Set<string> {
  const recognizedSubtitleHeaders = new Set<string>();
  const aliasMap = buildLangAliasMap();
  
  const extractBaseLang = (rawHeader: string): { base: string; variation?: string } => {
    const trimmed = rawHeader.trim().toLowerCase();
    const parenMatch = trimmed.match(/^([a-z]+(?:\s+[a-z]+)?)\s*\(([^)]+)\)\s*$/);
    if (parenMatch) {
      return { base: parenMatch[1].trim(), variation: parenMatch[2].trim() };
    }
    const hyphenMatch = trimmed.match(/^([a-z]{2,3})[-_](.+)$/);
    if (hyphenMatch) {
      return { base: hyphenMatch[1], variation: hyphenMatch[2] };
    }
    return { base: trimmed };
  };

  headers.forEach(h => {
    const key = (h || "").trim().toLowerCase().replace(/\s*[([].*?[)\]]\s*/g, "");
    
    // If user confirmed this column is a language, treat it as language
    if (confirmedAsLanguage.has(h)) {
      recognizedSubtitleHeaders.add(h);
      return;
    }
    
    // Skip reserved columns BEFORE language detection (but not ambiguous ones - let user decide)
    if (RESERVED_COLUMNS.has(key) && !AMBIGUOUS_COLS.has(key)) return;
    
    const alias = aliasMap[key];
    if (alias) {
      recognizedSubtitleHeaders.add(h);
      return;
    }
    if (SUPPORTED_CANON.includes(key as typeof SUPPORTED_CANON[number])) {
      recognizedSubtitleHeaders.add(h);
      return;
    }
    // Generalized pattern matching
    const { base } = extractBaseLang(h);
    const baseAlias = aliasMap[base];
    const baseCanon = baseAlias || (SUPPORTED_CANON.includes(base as typeof SUPPORTED_CANON[number]) ? base : null);
    if (baseCanon) {
      recognizedSubtitleHeaders.add(h);
    }
  });
  
  return recognizedSubtitleHeaders;
}

/**
 * Categorize headers into unrecognized, reserved, and ambiguous
 */
export function categorizeHeaders(
  headers: string[],
  confirmedAsLanguage: Set<string>,
  recognizedSubtitleHeaders: Set<string>
): {
  unrecognizedHeaders: string[];
  reservedHeaders: string[];
  ambiguousHeaders: string[];
} {
  const knownSingles = new Set([
    "start","end","type","length",
    "cefr","cefr level","cefr_level",
    "jlpt","jlpt level","jlpt_level",
    "hsk","hsk level","hsk_level",
    "difficulty score","difficulty_score","difficultyscore","score",
    "difficulty_percent","card_difficulty"
  ]);
  
  const isFrameworkDynamic = (raw: string) => {
    const key = raw.trim().toLowerCase().replace(/\s*[([].*?[)\]]\s*/g, "");
    return /^(?:difficulty|diff)[_:\-/ ]?[a-z0-9]+(?:[_:\-/ ][a-z_]{2,8})?$/i.test(key);
  };
  
  const unrecognized: string[] = [];
  const reserved: string[] = [];
  const ambiguous: string[] = [];
  const displayableReserved = new Set([
    "id", "card_id", "cardid", "card id",
    "no", "number", "card_number", "cardnumber", "card number"
  ]);
  
  for (const h of headers) {
    const raw = (h || '').trim();
    if (!raw) continue;
    const low = raw.toLowerCase();
    if (knownSingles.has(low)) continue;
    
    // If user confirmed this column is a language, don't treat as reserved
    if (confirmedAsLanguage.has(raw)) continue;
    
    // Check if it's an ambiguous column that needs user confirmation
    if (AMBIGUOUS_COLS.has(low) && displayableReserved.has(low)) {
      ambiguous.push(raw);
      continue;
    }
    
    // Check if it's a displayable reserved column (actively ignored)
    if (displayableReserved.has(low)) {
      reserved.push(raw);
      continue;
    }
    // Skip other reserved columns
    if (RESERVED_COLUMNS.has(low)) continue;
    if (recognizedSubtitleHeaders.has(raw)) continue;
    if (isFrameworkDynamic(raw)) continue;
    if (low === 'sentence') continue; // already an error
    unrecognized.push(raw);
  }
  
  return { unrecognizedHeaders: unrecognized, reservedHeaders: reserved, ambiguousHeaders: ambiguous };
}

/**
 * Find header matching a canonical language code
 */
export function findHeaderForLang(
  headers: string[],
  lang: string,
  confirmedAsLanguage?: Set<string>
): string | null {
  const rawAliases = expandCanonicalToAliases(lang);
  const normalizedAliases = rawAliases.map(a => a.toLowerCase().replace(/[_\s-]/g, ""));
  const variantAliases = rawAliases.filter(a => /\(.+\)/.test(a)).map(a => a.toLowerCase().replace(/[_\s-]/g, ""));
  // Strip brackets/parentheses from headers (like [CC], (CC)) before normalizing
  const headerNorms = headers.map(h => ({ 
    orig: h, 
    norm: h.toLowerCase().replace(/\s*[([].*?[)\]]\s*/g, "").replace(/[_\s-]/g, "") 
  }));
  
  // Special case: if looking for 'id' (Indonesian) and user confirmed it
  if (lang.toLowerCase() === 'id' && confirmedAsLanguage) {
    const confirmed = headers.find(h => confirmedAsLanguage.has(h) && h.toLowerCase() === 'id');
    if (confirmed) return confirmed;
  }
  // Special case: if looking for 'no' (Norwegian) and user confirmed it
  if (lang.toLowerCase() === 'no' && confirmedAsLanguage) {
    const confirmed = headers.find(h => confirmedAsLanguage.has(h) && h.toLowerCase() === 'no');
    if (confirmed) return confirmed;
  }
  
  // Prefer variant aliases (with parentheses) first
  for (const v of variantAliases) {
    const found = headerNorms.find(h => h.norm === v);
    if (found) return found.orig;
  }
  for (const a of normalizedAliases) {
    const found = headerNorms.find(h => h.norm === a);
    if (found) return found.orig;
  }
  return null;
}
