import React from "react";
import type { CardDoc } from "../types";
import { CONTENT_TYPES, CONTENT_TYPE_LABELS, type ContentType } from "../types/content";

interface Props {
  films: string[];
  filmTitleMap: Record<string, string>;
  filmTypeMap: Record<string, string | undefined>;
  allResults: CardDoc[];
  filmFilter: string | null;
  onSelect: (filmId: string | null) => void;
}

export default function SearchFilters({ films, filmTitleMap, filmTypeMap, allResults, filmFilter, onSelect }: Props) {
  // Count results per film for display
  const counts: Record<string, number> = React.useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of allResults) {
      const fid = String(c.film_id ?? "");
      if (!fid) continue;
      m[fid] = (m[fid] || 0) + 1;
    }
    return m;
  }, [allResults]);

  // Group films by type, preserving CONTENT_TYPES order, with an 'other' bucket at end if needed
  const grouped = React.useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const t of CONTENT_TYPES) map[t] = [];
    const other: string[] = [];
    for (const id of films) {
      const raw = (filmTypeMap[id] || '').toLowerCase();
      const t = (CONTENT_TYPES as string[]).includes(raw) ? raw : '';
      if (t) map[t].push(id); else other.push(id);
    }
    return { map, other };
  }, [films, filmTypeMap]);

  const totalCount = allResults.length;

  return (
    <aside className="col-span-12 md:col-span-3 space-y-4">
      <div className="pixel-filter-panel">
        <h5>Films by Type</h5>
        <button className={`pixel-filter-btn ${filmFilter===null? 'active':''}`} onClick={() => onSelect(null)}>
          All <span className="opacity-70">({totalCount})</span>
        </button>
        {CONTENT_TYPES.map((t) => {
          const list = grouped.map[t];
          if (!list || list.length === 0) return null;
          const label = CONTENT_TYPE_LABELS[t as ContentType] || t;
          return (
            <div key={t} className="mt-3">
              <div className="text-xs text-gray-400 font-semibold mb-1">{label}</div>
              <div className="max-h-[40vh] overflow-auto pr-1 space-y-1">
                {list.map((id) => (
                  <button
                    key={id}
                    className={`pixel-filter-btn ${filmFilter===id? 'active':''}`}
                    onClick={() => onSelect(id)}
                    title={id}
                  >
                    {filmTitleMap[id] || id}
                    <span className="float-right opacity-70">{counts[id] || 0}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {grouped.other.length > 0 && (
          <div className="mt-3">
            <div className="text-xs text-gray-400 font-semibold mb-1">Other</div>
            <div className="max-h-[40vh] overflow-auto pr-1 space-y-1">
              {grouped.other.map((id) => (
                <button
                  key={id}
                  className={`pixel-filter-btn ${filmFilter===id? 'active':''}`}
                  onClick={() => onSelect(id)}
                  title={id}
                >
                  {filmTitleMap[id] || id}
                  <span className="float-right opacity-70">{counts[id] || 0}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
