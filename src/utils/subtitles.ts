import type { CardDoc } from "../types";
import { canonicalizeLangCode, expandCanonicalToAliases, type CanonicalLang } from "./lang";

// Return canonical codes inferred from a card's subtitle keys
export function detectCodesFromCard(card: CardDoc): CanonicalLang[] {
  const keys = Object.keys(card.subtitle ?? {});
  const set = new Set<CanonicalLang>();
  keys.forEach((k) => {
    const c = canonicalizeLangCode(k);
    if (c) set.add(c);
  });
  return Array.from(set);
}

// Get subtitle string by canonical code; tries aliases present on the card
export function subtitleText(card: CardDoc, canonicalCode: string): string | undefined {
  const aliases = expandCanonicalToAliases(canonicalCode);
  const raw = card.subtitle ?? ({} as Record<string, string>);
  // Build a lowercase lookup map to tolerate mixed-case / hyphen variants
  const lowerMap: Record<string, string> = {};
  for (const k of Object.keys(raw)) {
    lowerMap[k.toLowerCase()] = raw[k];
  }
  for (const key of aliases) {
    const direct = raw[key];
    if (direct) return direct;
    const lowered = lowerMap[key.toLowerCase()];
    if (lowered) return lowered;
  }
  return undefined;
}

export function cardHasAnyLanguage(card: CardDoc, langs: string[]): boolean {
  if (!langs || langs.length === 0) return true;
  for (const l of langs) {
    const c = canonicalizeLangCode(l) || l.toLowerCase();
    if (subtitleText(card, c)) return true;
  }
  return false;
}

export function cardHasAllLanguages(card: CardDoc, langs: string[]): boolean {
  if (!langs || langs.length === 0) return true;
  for (const l of langs) {
    const c = canonicalizeLangCode(l) || l.toLowerCase();
    if (!subtitleText(card, c)) return false;
  }
  return true;
}

// Normalize spacing for CJK text commonly segmented with spaces.
// - Removes spaces between CJK-CJK pairs
// - Removes spaces around common JP/ZH punctuation
// - Also removes spaces between consecutive bracketed ruby groups, e.g. 漢[かん] 字[じ]
export function normalizeCjkSpacing(text: string): string {
  if (!text) return text;
  // Unicode ranges: Han 3400-9FFF (+ CJK Ext A/B in BMP/Fxx), Hiragana 3040-309F, Katakana 30A0-30FF
  const CJK = "[\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u3040-\\u30FF]";
  // Frequent JP/ZH punctuation used in subtitles
  const PUNCT = "[、。．・，,。！!？?：:；;「」『』（）()［］[]…—-]";
  // Broad whitespace class: ASCII space, NBSP, and full set of Unicode spaces including IDEOGRAPHIC SPACE (\u3000)
  const WS = "[\\s\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000]+";
  let s = text;
  // Normalize any leading/trailing exotic whitespace
  s = s.replace(new RegExp(`^${WS}`), "").replace(new RegExp(`${WS}$`), "");
  // 1) Collapse spaces between CJK characters
  s = s.replace(new RegExp(`(${CJK})${WS}(${CJK})`, "g"), "$1$2");
  // 2) Collapse spaces between ] and [ when they sandwich CJK bases (ruby bracketed groups)
  s = s.replace(new RegExp(`(]|${CJK})${WS}([|${CJK})`, "g"), "$1$2");
  // 3) Remove spaces before/after CJK punctuation
  s = s.replace(new RegExp(`(${CJK})${WS}(${PUNCT})`, "g"), "$1$2");
  s = s.replace(new RegExp(`(${PUNCT})${WS}(${CJK})`, "g"), "$1$2");
  return s;
}

