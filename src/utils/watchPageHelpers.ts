/**
 * Pure helper functions extracted from WatchPage to avoid recreating
 * on every render. These are all stateless and depend only on their arguments.
 */
import type { LevelFrameworkStats } from '../types';
import { canonicalizeLangCode } from './lang';

// ─── HTML escaping ───────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Japanese text normalization ─────────────────────────────────────────────

export function normalizeJapanese(text: string): string {
  try {
    const withoutTags = text.replace(/<[^>]+>/g, '');
    const nfkc = withoutTags.normalize('NFKC').replace(/\s+/g, '').replace(/\[[^\]]+\]/g, '');
    return nfkc.replace(/[\u30A1-\u30F6]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60)
    );
  } catch {
    return text
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, '')
      .replace(/\[[^\]]+\]/g, '')
      .replace(/[\u30A1-\u30F6]/g, (ch) =>
        String.fromCharCode(ch.charCodeAt(0) - 0x60)
      );
  }
}

export function hasJapanese(text: string): boolean {
  return /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(text);
}

export function normChar(ch: string): string {
  try {
    const nfkc = ch.normalize('NFKC');
    return nfkc.replace(/[\u30A1-\u30F6]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0x60)
    );
  } catch {
    return ch.replace(/[\u30A1-\u30F6]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0x60)
    );
  }
}

// ─── Highlight helpers ───────────────────────────────────────────────────────

export function highlightHtml(text: string, q: string): string {
  if (!q) return escapeHtml(text);
  try {
    if (hasJapanese(q) || hasJapanese(text)) {
      const qNorm = normalizeJapanese(q.trim());
      const posMap: number[] = [];
      let normalized = '';

      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (/\s/.test(ch) || ch === '[' || ch === ']') continue;
        if (i > 0 && text.lastIndexOf('[', i) > text.lastIndexOf(']', i)) continue;

        const norm = normChar(ch);
        for (let j = 0; j < norm.length; j++) {
          normalized += norm[j];
          posMap.push(i);
        }
      }

      const matchIdx = normalized.indexOf(qNorm);
      if (matchIdx === -1) return escapeHtml(text);

      const lastNormIdx = matchIdx + qNorm.length - 1;
      const lastOrigPos = posMap[lastNormIdx];

      let endPosExclusive = lastOrigPos + 1;
      for (let i = lastNormIdx + 1; i < posMap.length; i++) {
        if (posMap[i] === lastOrigPos) continue;
        else { endPosExclusive = posMap[i]; break; }
      }

      const before = text.slice(0, posMap[matchIdx]);
      const match = text.slice(posMap[matchIdx], endPosExclusive);
      const after = text.slice(endPosExclusive);

      return `${escapeHtml(before)}<span style="color: var(--hover-select)">${escapeHtml(match)}</span>${escapeHtml(after)}`;
    }

    const re = new RegExp(escapeRegExp(q), 'gi');
    return escapeHtml(text).replace(
      re,
      (match) => `<span style="color: var(--hover-select)">${escapeHtml(match)}</span>`
    );
  } catch (err) {
    console.warn('Highlight error:', err);
    return escapeHtml(text);
  }
}

export function highlightInsideHtmlPreserveTags(html: string, q: string, lang?: string): string {
  if (!q) return html;
  try {
    if (lang === 'ja' || hasJapanese(q)) {
      const qNorm = normalizeJapanese(q.trim());
      if (!qNorm) return html;

      const rubyRe = /<ruby>\s*<rb>([\s\S]*?)<\/rb>\s*<rt>([\s\S]*?)<\/rt>\s*<\/ruby>/gi;
      let hasRubyHighlights = false;
      const processed = html.replace(rubyRe, (m, rbContent, rtContent) => {
        const rbNorm = normalizeJapanese(rbContent);
        const rtNorm = normalizeJapanese(rtContent);
        if (!rbNorm && !rtNorm) return m;
        if (rtNorm.includes(qNorm) || rbNorm.includes(qNorm)) {
          hasRubyHighlights = true;
          return `<ruby><rb><span style="color: var(--hover-select)">${rbContent}</span></rb><rt><span style="color: var(--hover-select)">${rtContent}</span></rt></ruby>`;
        }
        return m;
      });

      if (hasRubyHighlights) return processed;

      const visibleChars: { char: string; htmlPos: number }[] = [];
      let i = 0;
      let inRtTag = false;

      while (i < html.length) {
        const char = html[i];
        if (char === '<') {
          const rtMatch = html.substring(i).match(/^<rt>/);
          const rtCloseMatch = html.substring(i).match(/^<\/rt>/);
          if (rtMatch) { inRtTag = true; i += rtMatch[0].length; continue; }
          if (rtCloseMatch) { inRtTag = false; i += rtCloseMatch[0].length; continue; }
          while (i < html.length && html[i] !== '>') i++;
          if (i < html.length && html[i] === '>') i++;
          continue;
        }
        if (inRtTag) { i++; continue; }
        if (/\s/.test(char)) { i++; continue; }
        visibleChars.push({ char, htmlPos: i });
        i++;
      }

      const posMap: number[] = [];
      let normalized = '';
      for (let vi = 0; vi < visibleChars.length; vi++) {
        const norm = normChar(visibleChars[vi].char);
        for (let j = 0; j < norm.length; j++) { normalized += norm[j]; posMap.push(vi); }
      }

      const matchIdx = normalized.indexOf(qNorm);
      if (matchIdx === -1) return html;
      const lastNormIdx = matchIdx + qNorm.length - 1;
      const startVisIdx = posMap[matchIdx];
      const lastVisIdx = posMap[lastNormIdx];
      let endVisIdxExclusive = lastVisIdx + 1;
      for (let k = lastNormIdx + 1; k < posMap.length; k++) {
        if (posMap[k] !== lastVisIdx) { endVisIdxExclusive = posMap[k]; break; }
      }

      let result = '';
      let htmlIdx = 0;
      let inRtTag2 = false;
      const charPositions = new Set(visibleChars.slice(startVisIdx, endVisIdxExclusive).map(v => v.htmlPos));
      while (htmlIdx < html.length) {
        const c = html[htmlIdx];
        if (c === '<') {
          const rtMatch = html.substring(htmlIdx).match(/^<rt>/);
          const rtCloseMatch = html.substring(htmlIdx).match(/^<\/rt>/);
          if (rtMatch) { result += rtMatch[0]; inRtTag2 = true; htmlIdx += rtMatch[0].length; continue; }
          if (rtCloseMatch) { result += rtCloseMatch[0]; inRtTag2 = false; htmlIdx += rtCloseMatch[0].length; continue; }
          const tagStart = htmlIdx; htmlIdx++;
          while (htmlIdx < html.length && html[htmlIdx] !== '>') htmlIdx++;
          if (htmlIdx < html.length && html[htmlIdx] === '>') htmlIdx++;
          result += html.substring(tagStart, htmlIdx);
          continue;
        }
        const shouldHighlight = !inRtTag2 && charPositions.has(htmlIdx);
        result += shouldHighlight ? `<span style="color: var(--hover-select)">${c}</span>` : c;
        htmlIdx++;
      }
      return result;
    }

    const re = new RegExp(escapeRegExp(q), 'gi');
    return html.replace(re, (match) => `<span style="color: var(--hover-select)">${match}</span>`);
  } catch (err) {
    console.warn('Highlight error:', err);
    return html;
  }
}

// ─── Ruby / furigana conversion ─────────────────────────────────────────────

export function bracketToRubyHtml(text: string, lang?: string): string {
  if (!text) return '';
  const re = /([^\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000[]+)\s*\[([^\]]+)\]/g;
  let last = 0;
  let out = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, m.index));
    const base = m[1];
    const reading = m[2];
    const hasKanji = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(base);
    const readingIsKanaOnly = /^[\u3040-\u309F\u30A0-\u30FFー]+$/.test(reading);

    if (lang === 'ja' && hasKanji && readingIsKanaOnly) {
      const simplePattern = /^([\u3040-\u309F\u30A0-\u30FFー]+)?([\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+)([\u3040-\u309F\u30A0-\u30FFー]+)?$/;
      const sp = base.match(simplePattern);
      if (sp) {
        const prefixKana = sp[1] || '';
        const kanjiPart = sp[2];
        const trailingKana = sp[3] || '';
        let readingCore = reading;
        if (trailingKana && readingCore.endsWith(trailingKana)) {
          readingCore = readingCore.slice(0, readingCore.length - trailingKana.length);
        }
        if (prefixKana) out += escapeHtml(prefixKana);
        out += `<ruby><rb>${escapeHtml(kanjiPart)}</rb><rt>${escapeHtml(readingCore)}</rt></ruby>`;
        if (trailingKana) out += `<span class="okurigana">${escapeHtml(trailingKana)}</span>`;
      } else {
        out += `<ruby><rb>${escapeHtml(base)}</rb><rt>${escapeHtml(reading)}</rt></ruby>`;
      }
    } else {
      out += `<ruby><rb>${escapeHtml(base)}</rb><rt>${escapeHtml(reading)}</rt></ruby>`;
    }
    last = m.index + m[0].length;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

// ─── Language code → CSS class name ──────────────────────────────────────────

export function codeToName(code: string): string {
  const c = (canonicalizeLangCode(code) || code).toLowerCase();
  const map: Record<string, string> = {
    en: "english", vi: "vietnamese", zh: "chinese", zh_trad: "chinese-tc",
    yue: "cantonese", ja: "japanese", ko: "korean", es: "spanish",
    ar: "arabic", th: "thai", fr: "french", de: "german", el: "greek",
    hi: "hindi", id: "indonesian", it: "italian", ms: "malay", nl: "dutch",
    pl: "polish", pt: "portuguese", ru: "russian", he: "hebrew",
    fil: "filipino", fi: "finnish", hu: "hungarian", is: "icelandic",
    ml: "malayalam", no: "norwegian", ro: "romanian", sv: "swedish",
    tr: "turkish", uk: "ukrainian", eu: "basque", bn: "bengali",
    ca: "catalan", hr: "croatian", cs: "czech", da: "danish", gl: "galician",
    "pt-br": "portuguese-br", "pt-pt": "portuguese-pt",
    "es-la": "spanish-la", "es-es": "spanish-es", ta: "tamil", te: "telugu",
  };
  return map[c] || c;
}

// ─── Level framework stats parser ─────────────────────────────────────────────

export function parseLevelStats(raw: unknown): LevelFrameworkStats | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw as LevelFrameworkStats;
  if (typeof raw === 'string') {
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr as LevelFrameworkStats : null;
    } catch {
      return null;
    }
  }
  return null;
}
