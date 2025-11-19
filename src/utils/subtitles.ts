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

