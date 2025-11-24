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
}

export default function SearchResultCard({
  card,
  highlightQuery,
  primaryLang,
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

  // Highlight query occurrences with a styled span; case-insensitive
  function highlightHtml(text: string, q: string): string {
    if (!q) return escapeHtml(text);
    try {
      const re = new RegExp(escapeRegExp(q), "gi");
      return escapeHtml(text).replace(
        re,
        (match) =>
          `<span class="bg-amber-400/80 text-black px-1 rounded">${escapeHtml(
            match
          )}</span>`
      );
    } catch {
      return escapeHtml(text);
    }
  }

  // Highlight occurrences inside already-safe HTML (e.g., ruby markup) without escaping tags
  function highlightInsideHtmlPreserveTags(html: string, q: string): string {
    if (!q) return html;
    try {
      const re = new RegExp(escapeRegExp(q), "gi");
      return html.replace(re, (match) => `<span class="bg-amber-400/80 text-black px-1 rounded">${match}</span>`);
    } catch {
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
    <div ref={ref} className="pixel-result-card relative overflow-hidden">
      <Link
        to={detailPath || "#"}
        className="shrink-0 relative z-10"
        onClick={(e) => { if (!detailPath) e.preventDefault(); }}
      >
        <img
          src={card.image_url}
          alt={card.id}
          loading="lazy"
          className="w-28 h-20 object-cover rounded-md border-2 border-pink-500 hover:opacity-90"
          onContextMenu={(e) => e.preventDefault()}
          draggable={false}
        />
      </Link>
      <div className="flex-1 min-w-0 relative z-10 flex flex-col">
        <div className="pixel-audio-container mb-2">
          <AudioPlayer src={card.audio_url} />
        </div>
        <div className="pixel-card-meta">
          <span className="ep-tag">EP {String(card.episode)}</span>
          <span className="time-range">{card.start.toFixed(2)}s–{card.end.toFixed(2)}s</span>
          {primaryLang && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-700 text-gray-100 text-[10px]">
              <span className={`fi fi-${countryCodeForLang(primaryLang)}`}></span>
              <span>{(canonicalizeLangCode(primaryLang) || primaryLang).toUpperCase()}</span>
            </span>
          )}
          <button
            className={`ml-auto pixel-btn-fav ${favorite ? "active" : ""}`}
            onClick={onToggleFavorite}
            title="Favorite"
          >
            ♥
          </button>
        </div>
        <div className="mt-3 space-y-1">
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
                html = q ? highlightInsideHtmlPreserveTags(rubyHtml, q) : rubyHtml;
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
  );
}
