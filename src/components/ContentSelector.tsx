import { useEffect, useState, useMemo } from 'react';
import { Search, Film, Book, Tv, Music, ChevronDown, ChevronUp } from 'lucide-react';
import { listFilms } from '../services/firestore';
import type { FilmDoc, CardDoc, LevelFrameworkStats } from '../types';
import { CONTENT_TYPES, CONTENT_TYPE_LABELS, type ContentType } from '../types/content';
import '../styles/components/content-selector.css';

interface ContentSelectorProps {
  value: string | null;
  onChange: (filmId: string | null) => void;
  allResults: CardDoc[]; // results after query (and difficulty filtering applied upstream)
  contentCounts?: Record<string, number>; // server-side counts across all results
  totalCount?: number; // server-side total count
  filmTypeMapExternal?: Record<string, string | undefined>; // optional external map to avoid refetch
  filmTitleMapExternal?: Record<string, string>;
  filmLangMapExternal?: Record<string, string>;
  filmStatsMapExternal?: Record<string, LevelFrameworkStats | null>; // level framework stats for each film
  mainLanguage?: string;
}

// ContentSelector replaces FilmSelector. Provides grouped listing + search box.
export default function ContentSelector({ value, onChange, allResults, contentCounts, filmTypeMapExternal, filmTitleMapExternal, filmLangMapExternal, filmStatsMapExternal, mainLanguage }: ContentSelectorProps) {
  const [films, setFilms] = useState<FilmDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set<string>([...CONTENT_TYPES, 'other']));

  useEffect(() => {
    if (filmTitleMapExternal && filmTypeMapExternal) return; // parent handles fetching
    setLoading(true);
    listFilms().then(d => { setFilms(d); }).catch(() => setFilms([])).finally(() => setLoading(false));
  }, [filmTitleMapExternal, filmTypeMapExternal]);

  // Build maps (prefer externals)
  const filmTitleMap: Record<string, string> = useMemo(() => {
    if (filmTitleMapExternal) return filmTitleMapExternal;
    const m: Record<string, string> = {};
    films.forEach(f => { m[f.id] = f.title || f.id; });
    return m;
  }, [films, filmTitleMapExternal]);

  const filmTypeMap: Record<string, string | undefined> = useMemo(() => {
    if (filmTypeMapExternal) return filmTypeMapExternal;
    const m: Record<string, string | undefined> = {};
    films.forEach(f => { m[f.id] = f.type; });
    return m;
  }, [films, filmTypeMapExternal]);

  const filmLangMap: Record<string, string> = useMemo(() => {
    if (filmLangMapExternal) return filmLangMapExternal;
    const m: Record<string, string> = {};
    films.forEach(f => { if (f.main_language) m[f.id] = f.main_language; });
    return m;
  }, [films, filmLangMapExternal]);

  const filmStatsMap: Record<string, LevelFrameworkStats | null> = useMemo(() => {
    if (filmStatsMapExternal) return filmStatsMapExternal;
    const m: Record<string, LevelFrameworkStats | null> = {};
    films.forEach(f => {
      const raw = f.level_framework_stats;
      if (!raw) { m[f.id] = null; return; }
      if (Array.isArray(raw)) { 
        m[f.id] = raw as unknown as LevelFrameworkStats; 
        return; 
      }
      if (typeof raw === 'string') {
        try { 
          const arr = JSON.parse(raw); 
          m[f.id] = Array.isArray(arr) ? (arr as unknown as LevelFrameworkStats) : null; 
        }
        catch { m[f.id] = null; }
      }
    });
    return m;
  }, [films, filmStatsMapExternal]);

  // Get dominant level for a film based on level_framework_stats
  const getDominantLevel = (filmId: string): string | null => {
    const stats = filmStatsMap[filmId];
    if (!stats || stats.length === 0) return null;
    
    // Find the framework entry with highest percentage level
    let maxLevel: string | null = null;
    let maxPercent = 0;
    
    for (const entry of stats) {
      const levels = entry.levels;
      for (const [level, percent] of Object.entries(levels)) {
        if (percent > maxPercent) {
          maxPercent = percent;
          maxLevel = level;
        }
      }
    }
    
    return maxLevel;
  };

  // Counts from allResults
  const counts: Record<string, number> = useMemo(() => {
    if (contentCounts) return contentCounts;
    const m: Record<string, number> = {};
    for (const c of allResults) {
      const fid = String(c.film_id ?? '');
      if (!fid) continue;
      m[fid] = (m[fid] || 0) + 1;
    }
    return m;
  }, [contentCounts, allResults]);

  // Available film ids from either external or fetched films, filtered by main language
  const filmIds: string[] = useMemo(() => {
    let ids = filmTitleMapExternal ? Object.keys(filmTitleMapExternal) : films.map(f => f.id);
    // Filter by main language if specified
    if (mainLanguage) {
      ids = ids.filter(id => {
        const lang = filmLangMap[id];
        return lang === mainLanguage;
      });
    }
    return ids;
  }, [films, filmTitleMapExternal, filmLangMap, mainLanguage]);

  // Apply search filter
  const normalizedSearch = search.trim().toLowerCase();
  const filteredIds = normalizedSearch ? filmIds.filter(id => {
    const title = (filmTitleMap[id] || id).toLowerCase();
    return title.includes(normalizedSearch) || id.toLowerCase().includes(normalizedSearch);
  }) : filmIds;

  // Hide contents with zero matching cards
  const visibleIds = useMemo(() => filteredIds.filter(id => (counts[id] || 0) > 0), [filteredIds, counts]);

  // Grouping
  const grouped = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const t of CONTENT_TYPES) map[t] = [];
    const other: string[] = [];
    for (const id of visibleIds) {
      const raw = (filmTypeMap[id] || '').toLowerCase();
      const t = (CONTENT_TYPES as string[]).includes(raw) ? raw : '';
      if (t) map[t].push(id); else other.push(id);
    }
    return { map, other };
  }, [visibleIds, filmTypeMap]);

  const toggleGroup = (key: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const typeIcon = (t: string) => {
    switch(t){
      case 'movie': return <Film className="type-icon"/>;
      case 'series': return <Tv className="type-icon"/>;
      case 'book': return <Book className="type-icon"/>;
      case 'audio': return <Music className="type-icon"/>;
      default: return null;
    }
  };

  // Get level badge for content item
  const getItemLevelBadge = (filmId: string) => {
    const level = getDominantLevel(filmId);
    if (level) return level;
    
    // Fallback to type letter if no level stats
    const type = (filmTypeMap[filmId] || '').toLowerCase();
    switch(type) {
      case 'movie': return 'M';
      case 'series': return 'S';
      case 'book': return 'B';
      case 'audio': return 'A';
      default: return '?';
    }
  };

  return (
    <div className="content-selector-panel">
      <div className="content-search-row">
        <div className="content-search-wrapper">
          <div className="content-search-icon"><Search className="w-4 h-4" /></div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="SEARCH NAME"
            className="content-search-input"
          />
        </div>
        <div className="typography-inter-3" style={{ textAlign: 'right', marginTop: '8px', color: 'var(--neutral)' }}>
          {value === null ? '0 selected' : '1 selected'}
        </div>
      </div>
      {CONTENT_TYPES.map(t => {
        const list = grouped.map[t];
        if (!list || list.length === 0) return null;
        const label = CONTENT_TYPE_LABELS[t as ContentType] || t;
        const isOpen = openGroups.has(t);
        return (
          <div key={t} className={`content-group ${isOpen?'open':'closed'}`}>
            <button type="button" className="content-group-header" onClick={() => toggleGroup(t)}>
              {typeIcon(t)}
              <span className="group-label-text">{label}</span>
              {isOpen ? <ChevronUp className="collapse-icon" /> : <ChevronDown className="collapse-icon" />}
            </button>
            <div className={`content-group-list-wrapper ${isOpen ? 'open' : 'closed'}`}>
              <div className="content-group-list">
                {list.map(id => {
                  const levelBadge = getItemLevelBadge(id);
                  return (
                    <button
                      key={id}
                      className={`content-item-btn ${value===id? 'active':''}`}
                      onClick={() => onChange(id)}
                      title={id}
                    >
                      <span className={`level-badge level-${levelBadge.toLowerCase()}`}>
                        {levelBadge}
                      </span>
                      <span className="content-item-text">{filmTitleMap[id] || id}</span>
                      <span className="item-count">{counts[id] || 0}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
      {grouped.other.length > 0 && (
        <div className={`content-group ${openGroups.has('other')? 'open':'closed'}`}> 
          <button type="button" className="content-group-header" onClick={() => toggleGroup('other')}>
            <span className="group-label-text">Other</span>
            {openGroups.has('other') ? <ChevronUp className="collapse-icon" /> : <ChevronDown className="collapse-icon" />}
          </button>
          <div className={`content-group-list-wrapper ${openGroups.has('other') ? 'open' : 'closed'}`}>
            <div className="content-group-list">
              {grouped.other.map(id => {
                const levelBadge = getItemLevelBadge(id);
                return (
                  <button
                    key={id}
                    className={`content-item-btn ${value===id? 'active':''}`}
                    onClick={() => onChange(id)}
                    title={id}
                  >
                    <span className={`level-badge level-${levelBadge.toLowerCase()}`}>
                      {levelBadge}
                    </span>
                    <span className="content-item-text">{filmTitleMap[id] || id}</span>
                    <span className="item-count">{counts[id] || 0}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {loading && <div className="text-xs mt-2 opacity-70">Loading...</div>}
    </div>
  );
}
