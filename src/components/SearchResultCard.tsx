import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { CardDoc } from "../types";
import { useUser } from "../context/UserContext";
import AudioPlayer from "./AudioPlayer";
import { toggleFavorite } from "../services/progress";
import { canonicalizeLangCode, countryCodeForLang } from "../utils/lang";
import { subtitleText, normalizeCjkSpacing } from "../utils/subtitles";
import { getCardByPath } from "../services/firestore";

interface Props {
  card: CardDoc;
  highlightQuery?: string; // optional search keyword to highlight in subtitles
  primaryLang?: string; // film's primary (audio) language to show first
  filmTitle?: string; // content title to display
}

export default function SearchResultCard({
  card,
  highlightQuery,
  primaryLang,
  filmTitle,
}: Props) {
  const { preferences, user, signInGoogle, favoriteIds, setFavoriteLocal } =
    useUser();
  const langs = useMemo(() => preferences.subtitle_languages || [], [preferences.subtitle_languages]);
  const [favorite, setFavorite] = useState<boolean>(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const [subsOverride, setSubsOverride] = useState<Record<string, string> | null>(null);

  const shownLangs = useMemo(() => {
    const effectiveCard = subsOverride ? { ...card, subtitle: { ...(card.subtitle || {}), ...subsOverride } } : card;
    const ORDER = [
      "en",
      "vi",
      "zh",
      "zh_trad",
      "yue", // Cantonese after Traditional Chinese
      "ja",
      "ko",
      "id",
      "th",
      "ms",
    ] as const;
    const orderIndex = (code: string) => {
      const idx = ORDER.indexOf(
        (canonicalizeLangCode(code) ||
          code) as unknown as (typeof ORDER)[number]
      );
      return idx === -1 ? 999 : idx;
    };
    // Determine which codes to show:
    // - Always show the film's primary language first (when provided)
    // - Then show user's selected secondary subtitle languages, ordered by our stable ORDER
    const primary = primaryLang
      ? canonicalizeLangCode(primaryLang) || primaryLang
      : undefined;
    // Build secondary list from user's subtitle preferences
    const secondaryAll = (
      langs && langs.length ? langs : []
    ).map((c) => canonicalizeLangCode(c) || (c as string));
    const uniqSecondary = Array.from(new Set(secondaryAll as string[]));
    const filteredSecondary = uniqSecondary.filter(
      (c) => !primary || c !== primary
    );
    const sortedSecondary = filteredSecondary.sort(
      (a, b) => orderIndex(a) - orderIndex(b)
    );
    // Always include primary (film's audio language) first, then selected subtitle languages
    const finalOrder = (primary ? [primary] : []).concat(sortedSecondary);
    // Keep primary ALWAYS (will fallback to sentence if no subtitle), secondaries only if subtitle exists
    return finalOrder.filter((code) => {
      if (primary && code === primary) return true; // always show primary
      return !!subtitleText(effectiveCard, code); // secondary needs subtitle
    });
  }, [card, subsOverride, langs, primaryLang]);

  // Lazy-fixup: if subtitles are missing in the list payload, fetch per-card detail once
  useEffect(() => {
    const hasSubs = card.subtitle && Object.keys(card.subtitle).length > 0;
    const film = card.film_id;
    const epSlug = card.episode_id || (typeof card.episode === "number" ? `e${card.episode}` : String(card.episode || ""));
    const cid = String(card.id || "");
    if (hasSubs || !film || !epSlug || !cid) {
      setSubsOverride(null);
      return;
    }
    let active = true;
    (async () => {
      try {
        const detail = await getCardByPath(film, epSlug, cid);
        // removed debug logging
        if (active && detail?.subtitle && Object.keys(detail.subtitle).length) {
          setSubsOverride(detail.subtitle);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      active = false;
    };
  }, [card.film_id, card.episode_id, card.episode, card.id, card.subtitle]);


  // Simple HTML escaper
  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Convert bracket furigana/pinyin/jyutping to safe HTML.
  // For Japanese tokens: attempt to split trailing okurigana (kana after Kanji) so reading centers over Kanji only.
  function bracketToRubyHtml(text: string, lang?: string): string {
    if (!text) return "";
    const re = /([^\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000[]+)\s*\[([^\]]+)\]/g;
    let last = 0;
    let out = "";
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out += escapeHtml(text.slice(last, m.index));
      const base = m[1];
      const reading = m[2];
      // removed debug logging
      const hasKanji = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(base);
      const readingIsKanaOnly = /^[\u3040-\u309F\u30A0-\u30FFー]+$/.test(reading);
      if (lang === 'ja' && hasKanji && readingIsKanaOnly) {
        // Pattern: optional leading kana, kanji block, optional trailing kana (simple token)
        const simplePattern = /^([\u3040-\u309F\u30A0-\u30FFー]+)?([\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+)([\u3040-\u309F\u30A0-\u30FFー]+)?$/;
        const sp = base.match(simplePattern);
        if (sp) {
          const prefixKana = sp[1] || '';
          const kanjiPart = sp[2];
          const trailingKana = sp[3] || '';
          let readingCore = reading;
            // If reading ends with trailing kana, trim it for annotation width
          if (trailingKana && readingCore.endsWith(trailingKana)) {
            readingCore = readingCore.slice(0, readingCore.length - trailingKana.length);
          }
          // Do NOT trim prefix; prefix kana often grammatical and absent from reading
          if (prefixKana) out += escapeHtml(prefixKana); // plain text before ruby
          out += `<ruby><rb>${escapeHtml(kanjiPart)}</rb><rt>${escapeHtml(readingCore)}</rt></ruby>`;
          if (trailingKana) out += `<span class="okurigana">${escapeHtml(trailingKana)}</span>`;
        } else {
          // Complex mixed token (punctuation / Latin / multiple kanji groups). Try heuristic: annotate last Kanji cluster near end.
          const lastCluster = base.match(/([\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+[\u3040-\u309F\u30A0-\u30FFー]*)$/);
          if (lastCluster && reading.length <= lastCluster[0].length * 2) {
            const cluster = lastCluster[0];
            const before = base.slice(0, base.length - cluster.length);
            // Split cluster into kanji + trailing kana if applicable
            const clusterMatch = cluster.match(/^([\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+)([\u3040-\u309F\u30A0-\u30FFー]+)?$/);
            if (clusterMatch) {
              const clusterKanji = clusterMatch[1];
              const clusterOkurigana = clusterMatch[2] || '';
              let readingCore = reading;
              if (clusterOkurigana && readingCore.endsWith(clusterOkurigana)) {
                readingCore = readingCore.slice(0, readingCore.length - clusterOkurigana.length);
              }
              out += escapeHtml(before);
              out += `<ruby><rb>${escapeHtml(clusterKanji)}</rb><rt>${escapeHtml(readingCore)}</rt></ruby>`;
              if (clusterOkurigana) out += `<span class="okurigana">${escapeHtml(clusterOkurigana)}</span>`;
            } else {
              // Fallback: annotate whole base
              out += `<ruby><rb>${escapeHtml(base)}</rb><rt>${escapeHtml(reading)}</rt></ruby>`;
            }
          } else {
            // Fallback simple
            out += `<ruby><rb>${escapeHtml(base)}</rb><rt>${escapeHtml(reading)}</rt></ruby>`;
          }
        }
      } else {
        out += `<ruby><rb>${escapeHtml(base)}</rb><rt>${escapeHtml(reading)}</rt></ruby>`;
      }
      last = m.index + m[0].length;
    }
    out += escapeHtml(text.slice(last));
    const CJK_RANGE = "\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u3040-\\u30FF";
    out = out
      .replace(/^\s+/, "").replace(/\s+$/, "")
      .replace(/<\/ruby>\s+<ruby>/g, "</ruby><ruby>")
      .replace(new RegExp(`([${CJK_RANGE}])\\s+<ruby>`, "g"), "$1<ruby>")
      .replace(new RegExp(`<\\/ruby>\\s+([${CJK_RANGE}])`, "g"), "</ruby>$1")
      .replace(/\s+([、。．・，。！!？?：:；;」』）］])/g, "$1")
      .replace(/([「『（［])\s+/g, "$1");
    return out;
  }

  // Normalize Japanese text for comparison: Katakana → Hiragana, remove whitespace, remove furigana brackets
  function normalizeJapanese(text: string): string {
    try {
      // First remove HTML tags if present
      const withoutTags = text.replace(/<[^>]+>/g, '');
      // NFKC normalization for width, remove all whitespace, remove furigana brackets
      const nfkc = withoutTags.normalize('NFKC').replace(/\s+/g, '').replace(/\[[^\]]+\]/g, '');
      // Convert Katakana to Hiragana
      return nfkc.replace(/[\u30A1-\u30F6]/g, (ch) => 
        String.fromCharCode(ch.charCodeAt(0) - 0x60)
      );
    } catch {
      // Fallback: just Katakana → Hiragana, remove whitespace, tags and brackets
      return text.replace(/<[^>]+>/g, '').replace(/\s+/g, '').replace(/\[[^\]]+\]/g, '').replace(/[\u30A1-\u30F6]/g, (ch) => 
        String.fromCharCode(ch.charCodeAt(0) - 0x60)
      );
    }
  }

  // Check if text contains Japanese characters
  function hasJapanese(text: string): boolean {
    return /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(text);
  }

  // Helper to normalize a single character (Katakana → Hiragana, NFKC)
  function normChar(ch: string): string {
    try {
      const nfkc = ch.normalize('NFKC');
      // Katakana → Hiragana conversion
      return nfkc.replace(/[\u30A1-\u30F6]/g, (c) => 
        String.fromCharCode(c.charCodeAt(0) - 0x60)
      );
    } catch {
      return ch.replace(/[\u30A1-\u30F6]/g, (c) => 
        String.fromCharCode(c.charCodeAt(0) - 0x60)
      );
    }
  }

  // Highlight query occurrences with a styled span; case-insensitive
  function highlightHtml(text: string, q: string): string {
    if (!q) return escapeHtml(text);
    try {
      // For Japanese text, use normalized comparison (ignore whitespace)
      if (hasJapanese(q) || hasJapanese(text)) {
        const qNorm = normalizeJapanese(q.trim());
        
        // Build normalized version of text, tracking position mapping
        const posMap: number[] = []; // posMap[i] = original position for normalized position i
        let normalized = '';
        
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          // Skip whitespace and brackets
          if (/\s/.test(ch) || ch === '[' || ch === ']') {
            continue;
          }
          // Inside bracket (furigana) - skip content
          if (i > 0 && text.lastIndexOf('[', i) > text.lastIndexOf(']', i)) {
            continue;
          }
          
          const norm = normChar(ch);
          for (let j = 0; j < norm.length; j++) {
            normalized += norm[j];
            posMap.push(i);
          }
        }
        
        // Find match in normalized text
        const matchIdx = normalized.indexOf(qNorm);
        if (matchIdx === -1) return escapeHtml(text);
        
        // Map back to original positions
        const startPos = posMap[matchIdx];
        // Find the end position: we need the position AFTER the last matched character
        // The last normalized char is at matchIdx + qNorm.length - 1
        // We want to include the full original character at that position
        const lastNormIdx = matchIdx + qNorm.length - 1;
        const lastOrigPos = posMap[lastNormIdx];
        
        // Find the next original position that's different (or end of text)
        let endPosExclusive = lastOrigPos + 1;
        // Check if there are more normalized chars pointing to the same original position
        for (let i = lastNormIdx + 1; i < posMap.length; i++) {
          if (posMap[i] === lastOrigPos) {
            // Still part of the same original character
            continue;
          } else {
            // Next char starts here
            endPosExclusive = posMap[i];
            break;
          }
        }
        
        const before = text.slice(0, startPos);
        const match = text.slice(startPos, endPosExclusive);
        const after = text.slice(endPosExclusive);
        
        return `${escapeHtml(before)}<span class="text-[#f3a1d6]">${escapeHtml(match)}</span>${escapeHtml(after)}`;
      }
      
      // Non-Japanese: simple regex match
      const re = new RegExp(escapeRegExp(q), "gi");
      return escapeHtml(text).replace(
        re,
        (match) => `<span class="text-[#f3a1d6]">${escapeHtml(match)}</span>`
      );
    } catch (err) {
      console.warn('Highlight error:', err);
      return escapeHtml(text);
    }
  }

  // Highlight occurrences inside already-safe HTML (e.g., ruby markup) without escaping tags
  function highlightInsideHtmlPreserveTags(html: string, q: string, lang?: string): string {
    if (!q) return html;
    try {
      // For Japanese, do smart matching on visible text (strip brackets and tags)
      if (lang === 'ja' || hasJapanese(q)) {
        const qNorm = normalizeJapanese(q.trim());
        if (!qNorm) return html;

        // Strategy: detect ruby groups and if q matches the rt reading (normalized),
        // highlight both the entire rb and rt content. Otherwise fall back to visible text matching.

        // Process ruby groups first
        const rubyRe = /<ruby>\s*<rb>([\s\S]*?)<\/rb>\s*<rt>([\s\S]*?)<\/rt>\s*<\/ruby>/gi;
        let hasRubyHighlights = false;
        const processed = html.replace(rubyRe, (m, rbContent, rtContent) => {
          const rbNorm = normalizeJapanese(rbContent);
          const rtNorm = normalizeJapanese(rtContent);
          if (!rbNorm && !rtNorm) return m;
          // If query matches the rt (reading), highlight both rb and rt
          if (rtNorm.includes(qNorm) || rbNorm.includes(qNorm)) {
            hasRubyHighlights = true;
            return `<ruby><rb><span class="text-[#f3a1d6]">${rbContent}</span></rb><rt><span class="text-[#f3a1d6]">${rtContent}</span></rt></ruby>`;
          }
          return m;
        });

        if (hasRubyHighlights) {
          return processed;
        }

        // Fallback: original visible text approach (no ruby reading match found)
        const visibleChars: { char: string; htmlPos: number }[] = [];
        let i = 0;
        let inRtTag = false;

        while (i < html.length) {
          const char = html[i];

          if (char === '<') {
            const rtMatch = html.substring(i).match(/^<rt>/);
            const rtCloseMatch = html.substring(i).match(/^<\/rt>/);

            if (rtMatch) {
              inRtTag = true;
              i += rtMatch[0].length;
              continue;
            } else if (rtCloseMatch) {
              inRtTag = false;
              i += rtCloseMatch[0].length;
              continue;
            }

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
            let tagStart = htmlIdx; htmlIdx++;
            while (htmlIdx < html.length && html[htmlIdx] !== '>') htmlIdx++;
            if (htmlIdx < html.length && html[htmlIdx] === '>') htmlIdx++;
            result += html.substring(tagStart, htmlIdx);
            continue;
          }
          const shouldHighlight = !inRtTag2 && charPositions.has(htmlIdx);
          result += shouldHighlight ? `<span class="text-[#f3a1d6]">${c}</span>` : c;
          htmlIdx++;
        }
        return result;
      }
      
      // Non-Japanese: simple regex on whole HTML
      const re = new RegExp(escapeRegExp(q), "gi");
      return html.replace(re, (match) => `<span class="text-[#f3a1d6]">${match}</span>`);
    } catch (err) {
      console.warn('Highlight error:', err);
      return html;
    }
  }

  useEffect(() => {
    // keep heart state in sync with account favorites
    setFavorite(user ? favoriteIds.has(card.id) : false);
  }, [user, favoriteIds, card.id]);

  const onToggleFavorite = async () => {
    if (!user) {
      await signInGoogle();
      return;
    }
    const episode_id =
      card.episode_id ||
      (typeof card.episode === "number"
        ? `e${card.episode}`
        : String(card.episode));
    const next = await toggleFavorite(user.uid, card.id, {
      film_id: card.film_id,
      episode_id,
    });
    setFavorite(next);
    setFavoriteLocal(card.id, next);
  };

  // add-to-deck deferred

  const detailPath =
    card.film_id &&
    (card.episode_id ||
      (typeof card.episode === "number"
        ? `e${card.episode}`
        : String(card.episode)))
      ? `/card/${card.film_id}/${
          card.episode_id ||
          (typeof card.episode === "number"
            ? `e${card.episode}`
            : String(card.episode))
        }/${card.id}`
      : undefined;

  return (
    <div ref={ref} className="pixel-result-card-new">
      <div className="card-main-content">
        {/* Left side: Image + Title */}
        <div className="card-left-section">
          <Link
            to={detailPath || "#"}
            className="block relative"
            onClick={(e) => { if (!detailPath) e.preventDefault(); }}
          >
            <img
              src={card.image_url}
              alt={card.id}
              loading="lazy"
              className="card-image"
              onContextMenu={(e) => e.preventDefault()}
              draggable={false}
            />
          </Link>
          <div className="card-info-box">
            <div className="card-info-row">
              {filmTitle && (
                <div className="card-title">{filmTitle}</div>
              )}
              {/* Level badges from card.levels array */}
              {card.levels && Array.isArray(card.levels) && card.levels.length > 0 && (
                <div className="level-badges-container">
                  {card.levels.map((lvl: { framework: string; level: string; language?: string }, idx: number) => (
                    <span key={idx} className={`level-badge level-${(lvl.level || '').toLowerCase()}`}>
                      {lvl.level}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="pixel-card-meta">
              <span className="ep-tag">EP {String(card.episode)}</span>
              {import.meta.env.VITE_LINK_ANKI && (
                <a 
                  href={import.meta.env.VITE_LINK_ANKI} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="pixel-btn-anki"
                  title="Add to Anki"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                  </svg>
                  Anki
                </a>
              )}
              <button
                className={`pixel-btn-fav ${favorite ? "active" : ""}`}
                onClick={onToggleFavorite}
                title="Favorite"
              >
                ♥
              </button>
            </div>
          </div>
        </div>

        {/* Right side: Subtitles */}
        <div className="card-right-section">
        <div className="card-subtitles">
          {(() => {
            const primaryCode = primaryLang
              ? canonicalizeLangCode(primaryLang) || primaryLang
              : undefined;
            // Primary should be shown even when no subtitle text is present (audio language)
            const codeToName = (code: string): string => {
              const c = (canonicalizeLangCode(code) || code).toLowerCase();
              const map: Record<string, string> = {
                en: "english",
                vi: "vietnamese",
                zh: "chinese",
                zh_trad: "chinese",
                yue: "chinese",
                ja: "japanese",
                ko: "korean",
                es: "spanish",
                ar: "arabic",
                th: "thai",
                fr: "french",
                de: "german",
                el: "greek",
                hi: "hindi",
                id: "indonesian",
                it: "italian",
                ms: "malay",
                nl: "dutch",
                pl: "polish",
                pt: "portuguese",
                ru: "russian",
              };
              return map[c] || c;
            };
            const effectiveCard = subsOverride ? { ...card, subtitle: { ...(card.subtitle || {}), ...subsOverride } } : card;
            const items = shownLangs;
            return items.map((code) => {
              let raw = subtitleText(effectiveCard, code) ?? "";
              const q = (highlightQuery ?? "").trim();
              const isPrimary = primaryCode === code;
              // If primary has no subtitle text, fallback to sentence so we can still show content
              if (isPrimary && !raw) {
                raw = effectiveCard.sentence ?? "";
              }
              const canon = (canonicalizeLangCode(code) || code).toLowerCase();
              const needsRuby = canon === "ja" || canon === "zh" || canon === "zh_trad" || canon === "yue";
              let html: string;
              if (needsRuby) {
                const normalized = normalizeCjkSpacing(raw);
                // Debug logging for Japanese / Chinese subtitle raw + normalized + parsed HTML
                // removed debug logging
                const rubyHtml = bracketToRubyHtml(normalized, canon);
                // removed debug logging
                html = q ? highlightInsideHtmlPreserveTags(rubyHtml, q, canon) : rubyHtml;
              } else {
                html = q ? highlightHtml(raw, q) : escapeHtml(raw);
              }
              const name = codeToName(code);
              const roleClass = isPrimary ? `${name}-main` : `${name}-sub`;
              const rubyClass = needsRuby ? "hanzi-ruby" : "";
              return (
                <div
                  key={code}
                  className={`${isPrimary ? "text-sm sm:text-base" : "text-xs text-gray-200"} ${roleClass} ${rubyClass}`}
                >
                  <span className={`inline-block align-middle mr-1.5 text-sm fi fi-${countryCodeForLang(code)}`}></span>
                  {isPrimary && (
                    <span className="align-middle mr-1.5 text-[9px] uppercase tracking-wide px-1 py-0.5 rounded bg-amber-400/90 text-black font-semibold">
                      Primary
                    </span>
                  )}
                  <span
                    className={isPrimary ? "font-semibold" : ""}
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                </div>
              );
            });
          })()}
        </div>
      </div>
      </div>

      {/* Audio Player - Full width at bottom */}
      <div className="card-audio-section">
        <AudioPlayer src={card.audio_url} />
        <div className="audio-time-range">
          {card.start.toFixed(2)}s – {card.end.toFixed(2)}s
        </div>
      </div>
    </div>
  );
}
