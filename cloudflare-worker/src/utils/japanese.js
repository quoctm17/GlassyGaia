// Japanese helpers: normalize Katakana to Hiragana and full-width forms
export function kataToHira(s) {
  return String(s).replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

export function normalizeJaInput(s) {
  try {
    // NFKC to normalize width; then convert Katakana to Hiragana
    return kataToHira(String(s).normalize('NFKC'));
  } catch {
    return kataToHira(String(s));
  }
}

export function hasHanAndKana(s) {
  return /\p{Script=Han}/u.test(s) && /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s);
}

export function kanaOnlyString(s) {
  // Keep only Hiragana/Katakana and ASCII letters/numbers for safety
  return String(s).replace(/[^\p{Script=Hiragana}\p{Script=Katakana}\p{L}\p{N}\s]/gu, '').trim();
}

// Expand Japanese index text by adding mixed kanji/kana tokens from bracketed furigana: 例) 黒川[くろかわ]
// Also normalizes whitespace for consistent FTS matching
// IMPORTANT: Indexes BOTH the base text (without brackets) AND the reading separately
// e.g., "番線[ばんせん]" -> indexes: "番線" (base) + "ばんせん" (reading) + mixed variants
export function expandJaIndexText(text) {
  // First, normalize whitespace (remove all spaces) for consistent FTS matching
  const src = String(text || '').replace(/\s+/g, '');

  const extra = [];
  const re = /(\p{Script=Han}+[\p{Script=Han}・・]*)\[([\p{Script=Hiragana}\p{Script=Katakana}]+)\]/gu;
  let baseText = src; // text with brackets removed
  let m;

  while ((m = re.exec(src)) !== null) {
    const kan = m[1];
    const rawKana = m[2];
    const hira = normalizeJaInput(rawKana);
    if (!kan || !hira) continue;

    // Add base kanji (without brackets) and reading separately to index
    extra.push(kan);
    extra.push(hira);

    // Add mixed kanji/kana variants for partial matching
    const firstKan = kan[0];
    const lastKan = kan[kan.length - 1];
    for (let i = 1; i < hira.length; i++) {
      const pref = hira.slice(0, i);
      const suff = hira.slice(i);
      extra.push(pref + lastKan);
      extra.push(firstKan + suff);
    }
  }

  // Remove all brackets from base text so "番線[ばんせん]" becomes "番線"
  baseText = baseText.replace(/\[[^\]]+\]/g, '');

  if (!extra.length) return baseText;

  // Deduplicate extras to keep FTS text compact
  const uniq = Array.from(new Set(extra.filter(Boolean)));

  // Index format: base_text + space + all_variants
  // This allows searching by base kanji OR reading OR mixed
  return `${baseText} ${uniq.join(' ')}`;
}
