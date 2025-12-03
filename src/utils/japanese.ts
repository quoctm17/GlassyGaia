// Utilities for Japanese text normalization

// Detect if a string contains Japanese characters (Kanji/Hiragana/Katakana)
export function hasJapanese(text: string): boolean {
  return /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(text);
}

// Convert Katakana to Hiragana and normalize width; remove whitespace and bracketed furigana
export function toHiragana(text: string): string {
  if (!text) return "";
  try {
    const withoutTags = text.replace(/<[^>]+>/g, "");
    const nfkc = withoutTags.normalize("NFKC").replace(/\s+/g, "").replace(/\[[^\]]+\]/g, "");
    return nfkc.replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  } catch {
    return text
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, "")
      .replace(/\[[^\]]+\]/g, "")
      .replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  }
}
