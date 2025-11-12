import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { getCardByPath, getFilmDoc } from "../services/firestore";
import type { CardDoc } from "../types";
import { useUser } from "../context/UserContext";
import LanguageSelector from "../components/LanguageSelector";
import { canonicalizeLangCode, countryCodeForLang } from "../utils/lang";
import { detectCodesFromCard, subtitleText } from "../utils/subtitles";

export default function CardDetailPage() {
  const { filmId = "", episodeId = "", cardId = "" } = useParams();
  const [card, setCard] = useState<CardDoc | null>(null);
  const { preferences } = useUser();
  const langs = preferences.subtitle_languages;
  const [primaryLang, setPrimaryLang] = useState<string | undefined>(undefined);
  const [availSubs, setAvailSubs] = useState<string[] | undefined>(undefined);

  useEffect(() => {
    getCardByPath(filmId, episodeId, cardId).then(setCard);
    if (filmId) {
      getFilmDoc(filmId).then((f) => {
  setPrimaryLang(f?.main_language || undefined);
        setAvailSubs(f?.available_subs);
      });
    }
  }, [filmId, episodeId, cardId]);

  const ordered = useMemo(() => {
    const ORDER = ["en","vi","zh","zh_trad","yue","ja","ko","id","th","ms"] as const;
    if (!card) return [] as string[];
    const baseSecondary = (langs?.length ? langs : detectCodesFromCard(card)).map((c) => canonicalizeLangCode(c) || (c as string));
    const primary = primaryLang ? (canonicalizeLangCode(primaryLang) || primaryLang) : undefined;
    const orderIndex = (code: string) => {
      const idx = ORDER.indexOf((canonicalizeLangCode(code) || code) as unknown as typeof ORDER[number]);
      return idx === -1 ? 999 : idx;
    };
    const uniqSecondary = Array.from(new Set(baseSecondary));
    const filteredSecondary = uniqSecondary.filter((c) => !primary || c !== primary);
    const sortedSecondary = filteredSecondary.sort((a,b)=>orderIndex(a)-orderIndex(b));
    const finalOrder = (primary ? [primary] : []).concat(sortedSecondary);
    return finalOrder.filter((code) => !!subtitleText(card, code));
  }, [card, langs, primaryLang]);

  if (!card) return <div className="p-6">Loading…</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-start gap-4">
        <img src={card.image_url} className="w-64 h-40 object-cover rounded border border-gray-700" />
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <audio controls src={card.audio_url} preload="none" />
            <div className="text-xs text-gray-400">ep {String(card.episode)} · {card.start.toFixed(2)}s–{card.end.toFixed(2)}s</div>
          </div>
          <div className="mt-2 flex justify-end">
            <LanguageSelector filmId={filmId} optionsOverride={availSubs} />
          </div>
          {card.sentence && <div className="mt-2 text-lg">{card.sentence}</div>}
          <div className="mt-3 space-y-1">
            {(() => {
              const primaryCode = primaryLang ? (canonicalizeLangCode(primaryLang) || primaryLang) : undefined;
              const primaryAvailable = primaryCode ? !!subtitleText(card, primaryCode) : false;
              return ordered.map((code, idx) => {
                const isPrimary = primaryAvailable && primaryCode === code && idx === 0;
                const html = subtitleText(card, code) ?? "";
                return (
                  <div key={code} className={isPrimary ? "text-lg sm:text-xl" : "text-base text-gray-200"}>
                    <span className={`inline-block align-middle mr-2 fi fi-${countryCodeForLang(code)}`}></span>
                    {isPrimary && (
                      <span className="align-middle mr-2 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-400/90 text-black font-semibold">Primary</span>
                    )}
                    <span className={isPrimary ? "font-semibold" : ""} dangerouslySetInnerHTML={{ __html: html }} />
                  </div>
                );
              })
            })()}
          </div>
          {card.words && (
            <div className="mt-4">
              <div className="text-sm text-gray-300 mb-1">Word examples</div>
              <ul className="list-disc pl-5 space-y-1">
                {Object.entries(card.words)
                  .filter(([, v]) => !!v)
                  .map(([k, v]) => (
                    <li key={k} className="text-sm text-gray-200">{v}</li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
