// Utilities for language display, normalization, and flag emoji

// Canonical codes we support across the app
// - zh: Chinese (Simplified)
// - zh_trad: Chinese (Traditional)
export type CanonicalLang =
  | "ar" | "eu" | "bn" | "yue" | "ca"
  | "zh" | "zh_trad" | "hr" | "cs" | "da"
  | "nl" | "en" | "fil" | "fi" | "fr" | "fr_ca"
  | "gl" | "de" | "el" | "he" | "hi" | "hu" | "is"
  | "id" | "it" | "ja" | "ko" | "ms" | "ml" | "no"
  | "pl" | "pt_br" | "pt_pt" | "ro" | "ru"
  | "es_la" | "es_es" | "sv" | "ta" | "te" | "th"
  | "tr" | "uk" | "vi"
  | "rec" | "triage"; // pseudo labels if needed

const aliasToCanonical: Record<string, CanonicalLang> = {
  // Base and country/legacy aliases
  en: "en", eng: "en", us: "en", gb: "en", english: "en",
  vi: "vi", vietnamese: "vi",
  ja: "ja", jp: "ja", japanese: "ja",
  ko: "ko", kr: "ko", korean: "ko",
  zh: "zh", cn: "zh", "zh-cn": "zh", zh_cn: "zh", chinese: "zh", chinese_simplified: "zh",
  tw: "zh_trad", "zh-tw": "zh_trad", zh_tw: "zh_trad", "zh-hant": "zh_trad", zh_hant: "zh_trad", zh_trad: "zh_trad", "chinese traditional": "zh_trad", traditional_chinese: "zh_trad",
  id: "id", "in": "id", indonesian: "id",
  th: "th", thai: "th",
  ms: "ms", my: "ms", malay: "ms",

  // Extended languages and names
  ar: "ar", arabic: "ar",
  eu: "eu", basque: "eu",
  bn: "bn", bengali: "bn",
  yue: "yue", cantonese: "yue", "zh-yue": "yue", zh_yue: "yue",
  ca: "ca", catalan: "ca",
  hr: "hr", croatian: "hr",
  cs: "cs", czech: "cs",
  da: "da", danish: "da",
  nl: "nl", dutch: "nl",
  fil: "fil", filipino: "fil", tl: "fil", tagalog: "fil",
  fi: "fi", finnish: "fi",
  fr: "fr", french: "fr",
  fr_ca: "fr_ca", "french canadian": "fr_ca", frcan: "fr_ca",
  gl: "gl", galician: "gl",
  de: "de", german: "de",
  el: "el", greek: "el",
  he: "he", iw: "he", hebrew: "he",
  hi: "hi", hindi: "hi",
  hu: "hu", hungarian: "hu",
  is: "is", icelandic: "is",
  it: "it", italian: "it",
  ml: "ml", malayalam: "ml",
  no: "no", norwegian: "no",
  pl: "pl", polish: "pl",
  pt_br: "pt_br", "portuguese (brazil)": "pt_br", ptbr: "pt_br", brazilian_portuguese: "pt_br",
  pt_pt: "pt_pt", "portuguese (portugal)": "pt_pt", ptpt: "pt_pt", portuguese: "pt_pt",
  ro: "ro", romanian: "ro",
  ru: "ru", russian: "ru",
  es_la: "es_la", "spanish (latin america)": "es_la", latam_spanish: "es_la",
  es_es: "es_es", "spanish (spain)": "es_es", spanish: "es_es",
  sv: "sv", swedish: "sv",
  ta: "ta", tamil: "ta",
  te: "te", telugu: "te",
  tr: "tr", turkish: "tr",
  uk: "uk", ukrainian: "uk",

  // Pseudo labels
  rec: "rec", triage: "triage",
};

const canonicalToAliases: Record<CanonicalLang, string[]> = {
  en: ["en", "us", "gb", "uk", "eng", "english"],
  vi: ["vi", "vietnamese"],
  ja: ["ja", "jp", "japanese"],
  ko: ["ko", "kr", "korean"],
  zh: ["zh", "cn", "zh-cn", "zh_cn", "chinese", "chinese_simplified"],
  zh_trad: ["zh_trad", "zh-tw", "zh_tw", "zh-hant", "zh_hant", "tw", "chinese traditional", "traditional_chinese"],
  id: ["id", "in", "indonesian"],
  th: ["th", "thai"],
  ms: ["ms", "my", "malay"],
  yue: ["yue", "cantonese", "zh-yue", "zh_yue"],
  ar: ["ar", "arabic"],
  eu: ["eu", "basque"],
  bn: ["bn", "bengali"],
  ca: ["ca", "catalan"],
  hr: ["hr", "croatian"],
  cs: ["cs", "czech"],
  da: ["da", "danish"],
  nl: ["nl", "dutch"],
  fil: ["fil", "tl", "tagalog", "filipino"],
  fi: ["fi", "finnish"],
  fr: ["fr", "french"],
  fr_ca: ["fr_ca", "french canadian", "frcan"],
  gl: ["gl", "galician"],
  de: ["de", "german"],
  el: ["el", "greek"],
  he: ["he", "iw", "hebrew"],
  hi: ["hi", "hindi"],
  hu: ["hu", "hungarian"],
  is: ["is", "icelandic"],
  it: ["it", "italian"],
  ml: ["ml", "malayalam"],
  no: ["no", "norwegian"],
  pl: ["pl", "polish"],
  pt_br: ["pt_br", "portuguese (brazil)", "ptbr", "brazilian_portuguese"],
  pt_pt: ["pt_pt", "portuguese (portugal)", "ptpt", "portuguese"],
  ro: ["ro", "romanian"],
  ru: ["ru", "russian"],
  es_la: ["es_la", "spanish (latin america)", "latam_spanish"],
  es_es: ["es_es", "spanish (spain)", "spanish"],
  sv: ["sv", "swedish"],
  ta: ["ta", "tamil"],
  te: ["te", "telugu"],
  tr: ["tr", "turkish"],
  uk: ["uk", "ukrainian"],
  rec: ["rec"],
  triage: ["triage"],
};

export function canonicalizeLangCode(code: string): CanonicalLang | undefined {
  const k = code.toLowerCase();
  return aliasToCanonical[k];
}

export function langLabel(code: string): string {
  const lang = canonicalizeLangCode(code) ?? (code.toLowerCase() as CanonicalLang);
  const map: Record<CanonicalLang, string> = {
    en: "English",
    vi: "Vietnamese",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese (Simplified)",
    zh_trad: "Chinese (Traditional)",
    id: "Indonesian",
    th: "Thai",
    ms: "Malay",
    yue: "Cantonese",
    ar: "Arabic",
    eu: "Basque",
    bn: "Bengali",
    ca: "Catalan",
    hr: "Croatian",
    cs: "Czech",
    da: "Danish",
    nl: "Dutch",
    fil: "Filipino",
    fi: "Finnish",
    fr: "French",
    fr_ca: "French (Canada)",
    gl: "Galician",
    de: "German",
    el: "Greek",
    he: "Hebrew",
    hi: "Hindi",
    hu: "Hungarian",
    is: "Icelandic",
    it: "Italian",
    ml: "Malayalam",
    no: "Norwegian",
    pl: "Polish",
    pt_br: "Portuguese (Brazil)",
    pt_pt: "Portuguese (Portugal)",
    ro: "Romanian",
    ru: "Russian",
    es_la: "Spanish (Latin America)",
    es_es: "Spanish (Spain)",
    sv: "Swedish",
    ta: "Tamil",
    te: "Telugu",
    tr: "Turkish",
    uk: "Ukrainian",
    rec: "Rec",
    triage: "Triage",
  } as const;
  return map[lang] ?? code.toUpperCase();
}

export function langFlag(code: string): string {
  const lang = canonicalizeLangCode(code) ?? (code.toLowerCase() as CanonicalLang);
  // Note: For zh we avoid showing TW text; flags are just visual. We use 🇨🇳 for zh and 🇹🇼 for zh_trad.
  const map: Record<CanonicalLang, string> = {
    en: "🇺🇸",
    vi: "🇻🇳",
    ja: "🇯🇵",
    ko: "🇰🇷",
    zh: "🇨🇳",
    zh_trad: "🇹🇼",
    id: "🇮🇩",
    th: "🇹🇭",
    ms: "🇲🇾",
    yue: "🇭🇰", // Cantonese -> Hong Kong
    ar: "🇸🇦",
    eu: "🇪🇸",
    bn: "🇧🇩",
    ca: "🇦🇩",
    hr: "🇭🇷",
    cs: "🇨🇿",
    da: "🇩🇰",
    nl: "🇳🇱",
    fil: "🇵🇭",
    fi: "🇫🇮",
    fr: "🇫🇷",
    fr_ca: "🇨🇦",
    gl: "🇪🇸",
    de: "🇩🇪",
    el: "🇬🇷",
    he: "🇮🇱",
    hi: "🇮🇳",
    hu: "🇭🇺",
    is: "🇮🇸",
    it: "🇮🇹",
    ml: "🇮🇳",
    no: "🇳🇴",
    pl: "🇵🇱",
    pt_br: "🇧🇷",
    pt_pt: "🇵🇹",
    ro: "🇷🇴",
    ru: "🇷🇺",
    es_la: "🇲🇽",
    es_es: "🇪🇸",
    sv: "🇸🇪",
    ta: "🇮🇳",
    te: "🇮🇳",
    tr: "🇹🇷",
    uk: "🇺🇦",
    rec: "🌐",
    triage: "🌐",
  } as const;
  return map[lang] ?? "🌐";
}

export function expandCanonicalToAliases(code: string): string[] {
  const c = canonicalizeLangCode(code);
  return c ? canonicalToAliases[c] : [code];
}

export function countryCodeForLang(code: string): string {
  const lang = canonicalizeLangCode(code) ?? (code.toLowerCase() as CanonicalLang);
  const map: Record<CanonicalLang, string> = {
    en: "us",
    vi: "vn",
    ja: "jp",
    ko: "kr",
    zh: "cn",
    zh_trad: "tw",
    id: "id",
    th: "th",
    ms: "my",
    yue: "hk",
    ar: "sa",
    eu: "es",
    bn: "bd",
    ca: "ad",
    hr: "hr",
    cs: "cz",
    da: "dk",
    nl: "nl",
    fil: "ph",
    fi: "fi",
    fr: "fr",
    fr_ca: "ca",
    gl: "es",
    de: "de",
    el: "gr",
    he: "il",
    hi: "in",
    hu: "hu",
    is: "is",
    it: "it",
    ml: "in",
    no: "no",
    pl: "pl",
    pt_br: "br",
    pt_pt: "pt",
    ro: "ro",
    ru: "ru",
    es_la: "mx",
    es_es: "es",
    sv: "se",
    ta: "in",
    te: "in",
    tr: "tr",
    uk: "ua",
    rec: "xx",
    triage: "xx",
  } as const;
  return map[lang] ?? "xx";
}

/**
 * Calculate text length appropriate for the language.
 * - Character-based languages (Chinese, Japanese, Thai, Cantonese): count characters (no spaces)
 * - Word-based languages (English, Vietnamese, etc.): count words (space-delimited)
 * @param text The text to measure
 * @param langCode The language code (e.g., "en", "zh", "ja")
 * @returns The calculated length
 */
export function calculateTextLength(text: string, langCode: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;

  const lang = canonicalizeLangCode(langCode) ?? (langCode.toLowerCase() as CanonicalLang);
  
  // Languages that count by characters (no word boundaries/spaces between words)
  const characterBasedLangs: Set<CanonicalLang> = new Set([
    "zh",       // Chinese (Simplified)
    "zh_trad",  // Chinese (Traditional)
    "ja",       // Japanese (Kanji, Hiragana, Katakana)
    "yue",      // Cantonese
    "th",       // Thai
  ]);

  if (characterBasedLangs.has(lang)) {
    // Count characters (excluding whitespace)
    return normalized.replace(/\s+/g, "").length;
  } else {
    // Count words (space-delimited tokens)
    // Split by whitespace and filter out empty strings
    const words = normalized.split(/\s+/).filter(w => w.length > 0);
    return words.length;
  }
}

