import { useEffect, useState, useMemo, useRef } from 'react';
import { listContentByType } from '../services/firestore';
import { apiGetFilm } from '../services/cfApi';
import type { FilmDoc, LevelFrameworkStats } from '../types';
import { CONTENT_TYPE_LABELS, type ContentType } from '../types/content';
import { useUser } from '../context/UserContext';
import { canonicalizeLangCode } from '../utils/lang';
import SearchBar from './SearchBar';
import rightAngleIcon from '../assets/icons/right-angle.svg';
import enterMovieIcon from '../assets/icons/enter-movie-view.svg';
import saveHeartIcon from '../assets/icons/save-heart.svg';
import watchlistIcon from '../assets/icons/watchlist.svg';
import LanguageTag from './LanguageTag';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import '../styles/components/content-type-grid.css';

interface ContentTypeGridProps {
  type: ContentType; // 'movie' | 'series' | 'book' | 'audio'
  headingOverride?: string; // optional custom heading
  limit?: number; // future: limit number of items
  onlySelectedMainLanguage?: boolean; // filter by user's selected main language
}

export default function ContentTypeGrid({ type, headingOverride, onlySelectedMainLanguage }: ContentTypeGridProps) {
  const [allItems, setAllItems] = useState<FilmDoc[]>([]); // all items from API
  const [expandedFilmId, setExpandedFilmId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true); // loading state for API
  const { preferences } = useUser();
  const selectedMain = preferences?.main_language || 'en';
  const navigate = useNavigate();

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  
  // Collapsed state for each level group
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const base = await listContentByType(type);
        const detailed = await Promise.all(base.map(async (f) => {
          const d = await apiGetFilm(f.id).catch(() => null);
          return d ? { ...f, ...d } : f;
        }));
        if (!mounted) return;
        const canonSelected = canonicalizeLangCode(selectedMain) || selectedMain;
        const filtered = onlySelectedMainLanguage
          ? detailed.filter((f) => {
              const canon = canonicalizeLangCode(f.main_language || '');
              return !!f.main_language && (canon || f.main_language) === canonSelected;
            })
          : detailed;
        setAllItems(filtered);
      } catch {
        if (mounted) setAllItems([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [type, onlySelectedMainLanguage, selectedMain]);

  // Get dominant level for a film based on level_framework_stats
  const getDominantLevel = (film: FilmDoc): string | null => {
    const stats = film.level_framework_stats as unknown as LevelFrameworkStats;
    if (!stats || !Array.isArray(stats) || stats.length === 0) {
      return null;
    }
    
    // Find the framework entry with highest percentage level
    let maxLevel: string | null = null;
    let maxPercent = 0;
    
    for (const entry of stats) {
      if (!entry.levels || typeof entry.levels !== 'object') continue;
      
      for (const [level, percent] of Object.entries(entry.levels)) {
        if (typeof percent === 'number' && percent > maxPercent) {
          maxPercent = percent;
          maxLevel = level.toUpperCase(); // Normalize to uppercase (N5, A1, etc.)
        }
      }
    }
    
    return maxLevel;
  };

  // Normalize level to group key (JLPT, CEFR, HSK → unified groups)
  const normalizeLevelToGroup = (level: string | null): string => {
    if (!level) return 'Unknown';
    
    const upper = level.toUpperCase();
    
    // JLPT: N5, N4, N3, N2, N1
    if (/^N[1-5]$/.test(upper)) return upper;
    
    // CEFR: A1→N5, A2→N4, B1→N3, B2→N2, C1/C2→N1
    const cefrMap: Record<string, string> = {
      'A1': 'A1',
      'A2': 'A2', 
      'B1': 'B1',
      'B2': 'B2',
      'C1': 'C1',
      'C2': 'C2'
    };
    if (cefrMap[upper]) return cefrMap[upper];
    
    // HSK: 1-2→N5, 3→N4, 4-5→N3, 6-7→N2, 8-9→N1
    const hskMatch = upper.match(/^(?:HSK[\s-]?)?([1-9])$/);
    if (hskMatch) {
      const num = parseInt(hskMatch[1]);
      if (num >= 1 && num <= 9) return `HSK${num}`;
    }
    
    return 'Unknown';
  };

  // Apply search and filters
  const filteredItems = useMemo(() => {
    let result = allItems;

    // Search filter (by title)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(item => 
        (item.title || '').toLowerCase().includes(q) ||
        (item.id || '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [allItems, searchQuery]);

  // Group by dominant level
  const groupedByLevel = useMemo(() => {
    const groups: Record<string, FilmDoc[]> = {
      // JLPT
      'N5': [],
      'N4': [],
      'N3': [],
      'N2': [],
      'N1': [],
      // CEFR
      'A1': [],
      'A2': [],
      'B1': [],
      'B2': [],
      'C1': [],
      'C2': [],
      // HSK
      'HSK1': [],
      'HSK2': [],
      'HSK3': [],
      'HSK4': [],
      'HSK5': [],
      'HSK6': [],
      'HSK7': [],
      'HSK8': [],
      'HSK9': [],
      'Unknown': []
    };

    for (const film of filteredItems) {
      const level = getDominantLevel(film);
      const groupKey = normalizeLevelToGroup(level);
      
      if (groups[groupKey]) {
        groups[groupKey].push(film);
      } else {
        groups['Unknown'].push(film);
      }
    }

    return groups;
  }, [filteredItems]);

  // Get all non-empty groups
  const nonEmptyGroups = useMemo(() => {
    const result: Array<{ level: string; films: FilmDoc[] }> = [];
    
    // Order: JLPT → CEFR → HSK → Unknown
    const levelsOrder = [
      'N5', 'N4', 'N3', 'N2', 'N1',
      'A1', 'A2', 'B1', 'B2', 'C1', 'C2',
      'HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6', 'HSK7', 'HSK8', 'HSK9',
      'Unknown'
    ];
    
    for (const level of levelsOrder) {
      const films = groupedByLevel[level] || [];
      if (films.length > 0) {
        result.push({ level, films });
      }
    }
    
    return result;
  }, [groupedByLevel]);

  const toggleGroup = (level: string) => {
    const newSet = new Set(collapsedGroups);
    if (newSet.has(level)) {
      newSet.delete(level);
    } else {
      newSet.add(level);
    }
    setCollapsedGroups(newSet);
  };

  const toggleExpand = (filmId: string) => {
    setExpandedFilmId(prev => prev === filmId ? null : filmId);
  };

  const label = headingOverride || CONTENT_TYPE_LABELS[type] || type;
  const R2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, '') || '';

  // Horizontal scroll handler for each level group
  const scrollRef = useRef<Record<string, HTMLDivElement | null>>({});
  const scroll = (level: string, direction: 'left' | 'right') => {
    const container = scrollRef.current[level];
    if (!container) return;
    const scrollAmount = direction === 'left' ? -800 : 800;
    container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
  };

  return (
    <div className="content-type-grid-container">
      <h1 className="content-type-grid-title">{label}</h1>
      
      {/* Search bar */}
      <div className="content-type-grid-search">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search by title..."
          showClear
          loading={loading}
        />
      </div>

      {/* Level groups */}
      <div className="level-groups-container">
        {loading ? (
          <div style={{ 
            padding: '40px', 
            textAlign: 'center', 
            color: 'var(--neutral)',
            fontFamily: "'Press Start 2P', monospace",
            fontSize: '14px'
          }}>
            Loading...
          </div>
        ) : nonEmptyGroups.length === 0 ? (
          <div style={{ 
            padding: '40px', 
            textAlign: 'center', 
            color: 'var(--neutral)',
            fontFamily: "'Press Start 2P', monospace",
            fontSize: '14px'
          }}>
            No content found
          </div>
        ) : (
          nonEmptyGroups.map(({ level, films }) => {
            const isCollapsed = collapsedGroups.has(level);

            return (
              <div key={level} className="level-group">
                <div className="level-group-header" onClick={() => toggleGroup(level)}>
                  <div className="level-group-badge">
                    <span style={{ color: 'var(--hover-select)', fontFamily: "'Press Start 2P', monospace", fontSize: '14px', marginRight: '8px' }}>Level</span>
                    <span className={`level-badge level-${level.toLowerCase()}`}>{level}</span>
                    <span className="level-count">({films.length})</span>
                  </div>
                  <button className="level-collapse-btn">
                    {isCollapsed ? '+' : '−'}
                  </button>
                </div>

                {!isCollapsed && (
                  <div className="level-group-content">
                    <button 
                      className="scroll-btn scroll-btn-left"
                      onClick={() => scroll(level, 'left')}
                    >
                      <img src={rightAngleIcon} alt="Previous" style={{ transform: 'rotate(180deg)' }} />
                    </button>
                    
                    <div 
                      className="level-films-scroll"
                      ref={(el) => { scrollRef.current[level] = el; }}
                    >
                      {films.map(f => {
                        const cover = f.cover_url || (R2Base ? `${R2Base}/items/${f.id}/cover_image/cover.jpg` : `/items/${f.id}/cover_image/cover.jpg`);
                        const dominantLevel = getDominantLevel(f);
                        const levelKey = normalizeLevelToGroup(dominantLevel);
                        const isExpanded = expandedFilmId === f.id;
                        
                        return (
                          <div
                            key={f.id}
                            className={`film-card ${isExpanded ? 'expanded' : ''}`}
                          >
                            <div className="film-card-image" onClick={() => toggleExpand(f.id)}>
                              {cover && (
                                <img
                                  src={cover}
                                  alt={String(f.title || f.id)}
                                  className="film-cover"
                                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                  draggable={false}
                                  onContextMenu={(e) => e.preventDefault()}
                                />
                              )}
                              {levelKey && (
                                <div className={`film-card-level-badge level-badge level-${levelKey.toLowerCase()}`}>
                                  {levelKey}
                                </div>
                              )}
                            </div>
                            
                            {/* Inline Detail Panel */}
                            <div className="film-detail-panel">
                              <button className="film-detail-close" onClick={(e) => { e.stopPropagation(); toggleExpand(f.id); }}>
                                <X size={16} />
                              </button>
                              
                              <h3 className="film-detail-title">{f.title || f.id}</h3>
                              
                              {(f.available_subs && f.available_subs.length > 0) && (
                                <div className="film-detail-subs-section">
                                  <button 
                                    className="subs-scroll-btn subs-scroll-btn-left"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const container = e.currentTarget.parentElement?.querySelector('.film-detail-subs');
                                      if (container) container.scrollBy({ left: -200, behavior: 'smooth' });
                                    }}
                                  >
                                    <img src={rightAngleIcon} alt="Previous" style={{ transform: 'rotate(180deg)', width: '12px', height: '12px' }} />
                                  </button>
                                  
                                  <div className="film-detail-subs">
                                    {f.available_subs.map(l => (
                                      <LanguageTag key={l} code={l} size="md" withName={false} />
                                    ))}
                                  </div>
                                  
                                  <button 
                                    className="subs-scroll-btn subs-scroll-btn-right"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const container = e.currentTarget.parentElement?.querySelector('.film-detail-subs');
                                      if (container) container.scrollBy({ left: 200, behavior: 'smooth' });
                                    }}
                                  >
                                    <img src={rightAngleIcon} alt="Next" style={{ width: '12px', height: '12px' }} />
                                  </button>
                                </div>
                              )}
                              
                              {f.description && (
                                <p className="film-detail-description" title={f.description}>
                                  {f.description}
                                </p>
                              )}
                              
                              <div className="film-detail-actions">
                                <button
                                  className="film-detail-learn-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/watch/${encodeURIComponent(f.id)}`);
                                  }}
                                >
                                  <img src={enterMovieIcon} alt="Learn" className="learn-icon" />
                                  <span>Learn</span>
                                </button>
                                
                                <div className="film-detail-action-icons">
                                  <button className="action-icon-btn" onClick={(e) => e.stopPropagation()}>
                                    <img src={saveHeartIcon} alt="Save" className="action-icon" />
                                  </button>
                                  <button className="action-icon-btn" onClick={(e) => e.stopPropagation()}>
                                    <img src={watchlistIcon} alt="Watchlist" className="action-icon" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    
                    <button 
                      className="scroll-btn scroll-btn-right"
                      onClick={() => scroll(level, 'right')}
                    >
                      <img src={rightAngleIcon} alt="Next" />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
