export function buildFtsQuery(q, language) {
  const cleaned = (q || '').trim();
  if (!cleaned) return '';

  // Detect if query contains Japanese characters (Hiragana, Katakana, or Kanji)
  const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(cleaned);

  // For Japanese: normalize whitespace AND remove furigana brackets from query
  // User might search "番線" but DB has "番線[ばんせん]" - we need to match the base kanji
  // This handles cases like "番線に" vs "番線 に" or "番線[ばんせん]に" in subtitle text
  let normalized = (hasJapanese || language === 'ja') ? cleaned.replace(/\s+/g, '') : cleaned;

  // For Japanese: also remove any furigana brackets from the query itself
  // e.g., user searches "番線[ばんせん]" -> normalize to "番線"
  if (hasJapanese || language === 'ja') {
    normalized = normalized.replace(/\[[^\]]+\]/g, '');
  }

  // If the user wraps text in quotes, treat it as an exact phrase
  const quotedMatch = normalized.match(/^\s*"([\s\S]+)"\s*$/);
  if (quotedMatch) {
    const phrase = quotedMatch[1].replace(/["']/g, '').replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim().replace(/\s+/g, ' ');
    return phrase ? `"${phrase}"` : '';
  }

  // With FTS5 trigram tokenizer, we can now use FTS for ALL languages including CJK
  // The trigram tokenizer handles CJK characters efficiently by breaking them into 3-character sequences
  // For CJK: normalize and wrap in quotes for phrase search
  if (hasJapanese || language === 'ja') {
    // Sanitize: Escape double quotes to prevent syntax errors
    const sanitized = normalized.replace(/"/g, '""');
    // Wrap in quotes for trigram phrase search
    return sanitized ? `"${sanitized}"` : '';
  }

  // Non-Japanese: tokenize by whitespace
  const tokens = normalized
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  if (!tokens.length) return '';

  if (tokens.length === 1) {
    const t = escapeFtsToken(tokens[0]);
    if (!t) return '';
    // Exact word matching (quoted) to avoid substring matches
    return `"${t}"`;
  }

  // Multi-word non-Japanese: exact phrase matching
  const phrase = tokens.map(escapeFtsToken).join(' ');
  return phrase ? `"${phrase}"` : '';
}

export function escapeFtsToken(t) {
  // Remove quotes and stray punctuation that might slip through
  return String(t).replace(/["'.,;:!?()\[\]{}]/g, '');
}

// Normalize Chinese text by removing pinyin brackets [pinyin] for search
// Example: "请[qǐng]问[wèn]" -> "请问"
export function normalizeChineseTextForSearch(text) {
  if (!text) return text;
  // Remove all [pinyin] patterns
  return text.replace(/\[[^\]]+\]/g, '');
}
