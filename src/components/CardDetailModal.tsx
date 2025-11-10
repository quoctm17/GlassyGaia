import type { CardDoc } from "../types";
import { useMemo } from "react";
import { useUser } from "../context/UserContext";

interface Props {
  card: CardDoc | null;
  open: boolean;
  onClose: () => void;
}

export default function CardDetailModal({ card, open, onClose }: Props) {
  const { preferences } = useUser();
  const langs = preferences.subtitle_languages;

  const ordered = useMemo(() => {
    if (!card) return [] as string[];
    const all = card.subtitle || {};
    const sel = langs.filter((l) => all[l]);
    const others = Object.keys(all).filter((l) => !sel.includes(l));
    return [...sel, ...others];
  }, [card, langs]);

  if (!open || !card) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-lg w-[min(92vw,900px)] max-h-[90vh] overflow-auto shadow-2xl p-4">
        <div className="flex items-start gap-4">
          <img src={card.image_url} alt={card.id} className="w-48 h-32 object-cover rounded border border-gray-700" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <audio controls src={card.audio_url} preload="none" />
              <div className="text-xs text-gray-400">ep {String(card.episode)} · {card.start.toFixed(2)}s–{card.end.toFixed(2)}s</div>
              <button className="ml-auto px-2 py-1 rounded bg-gray-700 hover:bg-gray-600" onClick={onClose}>✕</button>
            </div>
            {card.sentence && (
              <div className="mt-2 text-base text-gray-200">{card.sentence}</div>
            )}
            {card.CEFR_Level && (
              <div className="mt-1 text-xs text-gray-400">CEFR: {card.CEFR_Level}</div>
            )}
            <div className="mt-3 space-y-1">
              {ordered.map((code) => (
                <div key={code} className="text-sm">
                  <span className="uppercase text-gray-400 mr-2">{code}</span>
                  <span dangerouslySetInnerHTML={{ __html: card.subtitle?.[code] ?? "" }} />
                </div>
              ))}
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
    </div>
  );
}
