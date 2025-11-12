import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { CardDoc } from "../types";
import AudioWaveformPreview from "./AudioWaveformPreview";
import { useUser } from "../context/UserContext";
import { toggleFavorite } from "../services/progress";
import { canonicalizeLangCode, countryCodeForLang } from "../utils/lang";
import { subtitleText } from "../utils/subtitles";

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
  const langs = preferences.subtitle_languages;
  const [favorite, setFavorite] = useState<boolean>(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const shownLangs = useMemo(() => {
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
    // If user didn't choose any subtitle languages, show only the Primary language
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
    const finalOrder = (primary ? [primary] : []).concat(sortedSecondary);
    // Keep only those that actually have text on this card
    return finalOrder.filter((code) => !!subtitleText(card, code));
  }, [card, langs, primaryLang]);

  const onPlay = async () => {};

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

  // Hover audio waveform preview state
  const [hover, setHover] = useState(false);
  // Build preview URL: if VITE_PREVIEW_AUDIO_BASE is set, rewrite origin of card.audio_url
  // to that base (preserving the full R2 key path). Otherwise, use card.audio_url as-is.
  const previewBase = (import.meta.env.VITE_PREVIEW_AUDIO_BASE || "").replace(/\/$/, "");
  const previewUrl = (() => {
    try {
      if (previewBase) {
        const u = new URL(card.audio_url);
        return `${previewBase}${u.pathname}`;
      }
    } catch {
      // ignore malformed URL
    }
    return card.audio_url;
  })();

  return (
    <div
      ref={ref}
      className="pixel-result-card relative overflow-hidden"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <AudioWaveformPreview
        audioUrl={previewUrl}
        active={hover}
        className="absolute inset-0 pointer-events-none"
        barColor="#f472b6"
      />
      <Link
        to={detailPath || "#"}
        className="shrink-0 relative z-10"
        onClick={(e) => {
          if (!detailPath) e.preventDefault();
        }}
      >
        <img
          src={card.image_url}
          alt={card.id}
          className="w-28 h-20 object-cover rounded-md border-2 border-pink-500 hover:opacity-90"
        />
      </Link>
      <div className="flex-1 min-w-0 relative z-10">
        <div className="flex items-center gap-3">
          <audio controls preload="none" src={card.audio_url} onPlay={onPlay} />
          <div className="text-xs text-gray-400">
            ep {String(card.episode)} · {card.start.toFixed(2)}s–
            {card.end.toFixed(2)}s
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              className={`pixel-btn-fav ${favorite ? "active" : ""}`}
              onClick={onToggleFavorite}
              title="Favorite"
            >
              ♥
            </button>
            {/* Deck feature deferred */}
          </div>
        </div>
        <div className="mt-2 space-y-1">
          {(() => {
            const primaryCode = primaryLang
              ? canonicalizeLangCode(primaryLang) || primaryLang
              : undefined;
            const primaryAvailable = primaryCode
              ? !!subtitleText(card, primaryCode)
              : false;
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
            const items = shownLangs;
            return items.map((code) => {
              const raw = subtitleText(card, code) ?? "";
              const q = (highlightQuery ?? "").trim();
              const html = q ? highlightHtml(raw, q) : escapeHtml(raw);
              const isPrimary = primaryAvailable && primaryCode === code;
              const name = codeToName(code);
              const roleClass = isPrimary ? `${name}-main` : `${name}-sub`;
              const rubyClass = isPrimary && ["zh", "ja", "zh_trad"].includes(
                (canonicalizeLangCode(code) || code).toLowerCase()
              )
                ? "hanzi-ruby"
                : "";
              return (
                <div
                  key={code}
                  className={`${isPrimary ? "text-base sm:text-lg" : "text-sm text-gray-200"} ${roleClass} ${rubyClass}`}
                >
                  <span
                    className={`inline-block align-middle mr-2 fi fi-${countryCodeForLang(
                      code
                    )}`}
                  ></span>
                  {isPrimary && (
                    <span className="align-middle mr-2 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-400/90 text-black font-semibold">
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
        {detailPath && (
          <div className="mt-2">
            <Link to={detailPath} className="pixel-btn-fav">
              Details
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
