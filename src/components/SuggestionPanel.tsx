import { useMemo } from "react";
import { canonicalizeLangCode, countryCodeForLang } from "../utils/lang";
import { useUser } from "../context/UserContext";

interface Props {
  filmId: string;
  onPick: (query: string) => void;
}

const SAMPLES: Record<string, string[]> = {
  // Curated to match early cards in your dataset
  en: [
    "once upon a time",
    "her name was",
    "lived happily with her father",
    "fine clothes and jewelry",
  ],
  vi: [
    "ngày xưa",
    "tên cô ấy là",
    "sống hạnh phúc bên cha mình",
    "áo quần áo đẹp và trang sức quý",
  ],
  zh: [
    "从前",
    "她的名字叫",
    "和父亲一起幸福地生活",
    "漂亮的衣服和珠宝",
  ],
  zh_trad: [
    "從前",
    "她的名字叫",
    "和父親一起幸福地生活",
    "漂亮的衣服和珠寶",
  ],
  ja: [
    "むかしむかし",
    "名前は",
    "父と幸せに暮らしていました",
    "きれいな服と宝石",
  ],
  ko: [
    "옛날 옛적에",
    "이름은",
    "아버지와 행복하게 살았어요",
    "멋진 옷과 보석",
  ],
};

export default function SuggestionPanel({ filmId, onPick }: Props) {
  const { preferences } = useUser();
  const suggestions = useMemo(() => {
    const list: { lang: string; value: string }[] = [];
    // Only use main language from preferences
    const mainLang = preferences.main_language || "en";
    const c = canonicalizeLangCode(mainLang) || mainLang;
    (SAMPLES[c] || []).forEach((v) => list.push({ lang: c, value: v }));
    return list.slice(0, 16);
  }, [preferences.main_language]);

  if (suggestions.length === 0) return null;

  return (
    <div className="mt-6 pixel-suggestion-panel">
      <h6>
        Try these searches in <span className="font-semibold">{filmId}</span>
      </h6>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((s, i) => (
          <button
            key={s.lang + i}
            onClick={() => onPick(s.value)}
            className="pixel-suggest-tag"
            title={`Search in ${s.lang.toUpperCase()}`}
          >
            <span className={`inline-block align-middle mr-2 fi fi-${countryCodeForLang(s.lang)}`}></span>
            {s.value}
          </button>
        ))}
      </div>
    </div>
  );
}
