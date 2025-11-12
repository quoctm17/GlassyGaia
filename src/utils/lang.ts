// Utilities for language display, normalization, and flag emoji

// Canonical codes we support across the app
// - zh: Chinese (Simplified)
// - zh_trad: Chinese (Traditional)
export type CanonicalLang =
  | "en"
  | "vi"
  | "ja"
  | "ko"
  | "zh"
  | "zh_trad"
  | "id"
  | "th"
  | "ms"
  | "yue"; // Cantonese

const aliasToCanonical: Record<string, CanonicalLang> = {
  en: "en",
  eng: "en",
  us: "en",
  gb: "en",
  uk: "en",

  vi: "vi",

  ja: "ja",
  jp: "ja",

  ko: "ko",
  kr: "ko",

  zh: "zh",
  cn: "zh",
  "zh-cn": "zh",
  zh_cn: "zh",

  tw: "zh_trad",
  "zh-tw": "zh_trad",
  zh_tw: "zh_trad",
  "zh-hant": "zh_trad",
  zh_hant: "zh_trad",
  zh_trad: "zh_trad",

  id: "id",
  "in": "id",

  th: "th",

  ms: "ms",
  my: "ms",

  // Cantonese (Yue Chinese)
  yue: "yue",
  cantonese: "yue",
  "zh-yue": "yue",
  zh_yue: "yue",
};

const canonicalToAliases: Record<CanonicalLang, string[]> = {
  en: ["en", "us", "gb", "uk", "eng"],
  vi: ["vi"],
  ja: ["ja", "jp"],
  ko: ["ko", "kr"],
  zh: ["zh", "cn", "zh-cn", "zh_cn"],
  zh_trad: ["zh_trad", "zh-tw", "zh_tw", "zh-hant", "zh_hant", "tw"],
  id: ["id", "in"],
  th: ["th"],
  ms: ["ms", "my"],
  yue: ["yue", "cantonese", "zh-yue", "zh_yue"],
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
    yue: "🇭🇰", // Using Hong Kong flag for Cantonese
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
  } as const;
  return map[lang] ?? "xx";
}

