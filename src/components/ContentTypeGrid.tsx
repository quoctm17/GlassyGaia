import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart, Star } from 'lucide-react';
import { listContentByType } from '../services/firestore';
import { 
  apiGetFilm, 
  apiGetSRSDistribution, 
  apiGetSavedCardsCount,
  apiGetLikeCount,
  apiGetLikeStatus,
  apiToggleLike,
  type SRSDistribution 
} from '../services/cfApi';
import type { FilmDoc, LevelFrameworkStats } from '../types';
import { type ContentType } from '../types/content';
import { useUser } from '../context/UserContext';
import { canonicalizeLangCode } from '../utils/lang';
import SearchBar from './SearchBar';
import ContentTypeSelector from './ContentTypeSelector';
import rightAngleIcon from '../assets/icons/right-angle.svg';
import saveHeartIcon from '../assets/icons/save-heart.svg';
import LanguageTag from './LanguageTag';
import { sortLevelsByDifficulty } from '../utils/levelSort';
import { getLevelBadgeColors } from '../utils/levelColors';
import '../styles/components/content-type-grid.css';

interface ContentTypeGridProps {
  type: ContentType; // 'movie' | 'series' | 'book' | 'audio'
  headingOverride?: string; // optional custom heading
  limit?: number; // future: limit number of items
  onlySelectedMainLanguage?: boolean; // filter by user's selected main language
  showContentTypeSelector?: boolean; // show content type selector instead of framework label
  onContentTypeChange?: (type: ContentType) => void; // callback when content type changes
}

export default function ContentTypeGrid({ 
  type, 
  onlySelectedMainLanguage,
  showContentTypeSelector = false,
  onContentTypeChange
}: ContentTypeGridProps) {
  const [allItems, setAllItems] = useState<FilmDoc[]>([]); // all items from API
  const [expandedFilmId, setExpandedFilmId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true); // loading state for API
  const [srsDistributions, setSrsDistributions] = useState<Record<string, SRSDistribution>>({});
  const [savedCardsCounts, setSavedCardsCounts] = useState<Record<string, number>>({});
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [likeStatuses, setLikeStatuses] = useState<Record<string, boolean>>({});
  const { user, preferences } = useUser();
  const selectedMain = preferences?.main_language || 'en';
  const navigate = useNavigate();

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  
  // Get current framework based on main language (no dropdown needed)
  const currentFramework = useMemo(() => {
    const lang = selectedMain.toLowerCase();
    if (lang === 'ja' || lang.startsWith('ja')) return 'jlpt';
    if (lang === 'zh' || lang.startsWith('zh')) return 'hsk';
    return 'cefr'; // Default to CEFR for English and others
  }, [selectedMain]);
  
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

  // Parse level framework stats
  const parseLevelStats = (raw: unknown): LevelFrameworkStats | null => {
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
  };

  // Get dominant level for a film based on level_framework_stats
  const getDominantLevel = (film: FilmDoc): string | null => {
    const stats = parseLevelStats(film.level_framework_stats);
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

  // Load SRS distributions, saved cards counts, like counts, and like statuses for all films
  useEffect(() => {
    if (allItems.length === 0) return;
    
    let mounted = true;
    (async () => {
      const distributions: Record<string, SRSDistribution> = {};
      const savedCounts: Record<string, number> = {};
      const likes: Record<string, number> = {};
      const liked: Record<string, boolean> = {};
      
      // Load data for all films in parallel
      await Promise.all(
        allItems.map(async (film) => {
          try {
            // Load SRS distribution (requires user)
            if (user?.uid) {
              try {
                const dist = await apiGetSRSDistribution(user.uid, film.id);
                if (mounted) {
                  distributions[film.id] = dist;
                }
              } catch (error) {
                console.error(`Failed to load SRS distribution for ${film.id}:`, error);
                if (mounted) {
                  distributions[film.id] = { none: 100, new: 0, again: 0, hard: 0, good: 0, easy: 0 };
                }
              }
              
              // Load saved cards count
              try {
                const count = await apiGetSavedCardsCount(user.uid, film.id);
                if (mounted) {
                  savedCounts[film.id] = count;
                }
              } catch (error) {
                console.error(`Failed to load saved cards count for ${film.id}:`, error);
                if (mounted) {
                  savedCounts[film.id] = 0;
                }
              }
              
              // Load like status
              try {
                const status = await apiGetLikeStatus(user.uid, film.id);
                if (mounted) {
                  liked[film.id] = status;
                }
              } catch (error) {
                console.error(`Failed to load like status for ${film.id}:`, error);
                if (mounted) {
                  liked[film.id] = false;
                }
              }
            } else {
              // No user, set defaults
              if (mounted) {
                distributions[film.id] = { none: 100, new: 0, again: 0, hard: 0, good: 0, easy: 0 };
                savedCounts[film.id] = 0;
                liked[film.id] = false;
              }
            }
            
            // Load like count (doesn't require user)
            try {
              const count = await apiGetLikeCount(film.id);
              if (mounted) {
                likes[film.id] = count;
              }
            } catch (error) {
              console.error(`Failed to load like count for ${film.id}:`, error);
              if (mounted) {
                likes[film.id] = 0;
              }
            }
          } catch (error) {
            console.error(`Failed to load data for ${film.id}:`, error);
          }
        })
      );
      
      if (mounted) {
        setSrsDistributions(distributions);
        setSavedCardsCounts(savedCounts);
        setLikeCounts(likes);
        setLikeStatuses(liked);
      }
    })();
    
    return () => { mounted = false; };
  }, [user?.uid, allItems]);

  // Get SRS distribution for a film
  const getSRSDistribution = (film: FilmDoc): SRSDistribution => {
    if (!user?.uid) {
      // No user, return all none
      return { none: 100, new: 0, again: 0, hard: 0, good: 0, easy: 0 };
    }
    
    return srsDistributions[film.id] || { none: 100, new: 0, again: 0, hard: 0, good: 0, easy: 0 };
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

  // Get all non-empty groups filtered by framework
  const nonEmptyGroups = useMemo(() => {
    const result: Array<{ level: string; films: FilmDoc[] }> = [];
    
    // Define level orders by framework
    const jlptOrder = ['N5', 'N4', 'N3', 'N2', 'N1'];
    const cefrOrder = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const hskOrder = ['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6', 'HSK7', 'HSK8', 'HSK9'];
    
    let levelsOrder: string[] = [];
    if (currentFramework === 'jlpt') {
      levelsOrder = [...jlptOrder, 'Unknown'];
    } else if (currentFramework === 'cefr') {
      levelsOrder = [...cefrOrder, 'Unknown'];
    } else if (currentFramework === 'hsk') {
      levelsOrder = [...hskOrder, 'Unknown'];
    } else {
      // Fallback to all frameworks
      levelsOrder = [
        ...jlptOrder,
        ...cefrOrder,
        ...hskOrder,
        'Unknown'
      ];
    }
    
    for (const level of levelsOrder) {
      const films = groupedByLevel[level] || [];
      if (films.length > 0) {
        result.push({ level, films });
      }
    }
    
    return result;
  }, [groupedByLevel, currentFramework]);

  const toggleGroup = (level: string) => {
    const newSet = new Set(collapsedGroups);
    if (newSet.has(level)) {
      newSet.delete(level);
    } else {
      newSet.add(level);
    }
    setCollapsedGroups(newSet);
  };

  const toggleExpand = (filmId: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    
    // If already expanded and clicking on the same card, navigate to WatchPage
    if (expandedFilmId === filmId) {
      navigate(`/watch/${filmId}`);
      return;
    }
    
    // Otherwise, toggle expand/collapse
    setExpandedFilmId(prev => prev === filmId ? null : filmId);
  };

  // Get framework label
  const getFrameworkLabel = (framework: 'jlpt' | 'cefr' | 'hsk'): string => {
    if (framework === 'jlpt') return 'JLPT Level';
    if (framework === 'cefr') return 'CEFR Level';
    if (framework === 'hsk') return 'HSK Level';
    return 'Level';
  };

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
      {/* Search bar */}
      <div className="content-type-grid-search">
        <div className="content-type-grid-search-row">
          <div className="framework-dropdown-container">
            {showContentTypeSelector && onContentTypeChange ? (
              <ContentTypeSelector
                value={type}
                onChange={onContentTypeChange}
              />
            ) : (
              <div className="framework-dropdown-btn">
                <span>{getFrameworkLabel(currentFramework)}</span>
              </div>
            )}
          </div>
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by title..."
            showClear
            loading={loading}
          />
        </div>
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
                    <span style={{ color: 'var(--hover-select)', fontFamily: "'Press Start 2P', monospace", fontSize: '14px'}}>Level</span>
                    <span style={{ color: 'var(--hover-select)', fontFamily: "'Press Start 2P', monospace", fontSize: '14px' }}>{level}</span>
                    <img 
                      src={rightAngleIcon} 
                      alt="Expand" 
                      className={`level-group-icon ${isCollapsed ? 'collapsed' : 'expanded'}`}
                    />
                  </div>
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
                            onClick={(e) => toggleExpand(f.id, e)}
                          >
                            <div className="film-card-image">
                              {cover ? (
                                <>
                                  <img
                                    src={cover}
                                    alt={String(f.title || f.id)}
                                    className="film-cover"
                                    onError={e => { 
                                      const target = e.target as HTMLImageElement;
                                      target.style.display = 'none';
                                      const placeholder = target.nextElementSibling as HTMLElement;
                                      if (placeholder && placeholder.classList.contains('film-cover-placeholder')) {
                                        placeholder.style.display = 'flex';
                                      }
                                    }}
                                    draggable={false}
                                    onContextMenu={(e) => e.preventDefault()}
                                  />
                                  <div className="film-cover-placeholder" style={{ display: 'none' }}>
                                    <span>{f.title || f.id}</span>
                                  </div>
                                </>
                              ) : (
                                <div className="film-cover-placeholder">
                                  <span>{f.title || f.id}</span>
                                </div>
                              )}
                              {levelKey && (
                                <div className={`film-card-level-badge level-badge level-${levelKey.toLowerCase()}`}>
                                  {levelKey}
                                </div>
                              )}
                              
                              {/* Total cards count - top right */}
                              {f.num_cards !== null && f.num_cards !== undefined && (
                                <div className="film-card-total-count">
                                  {f.num_cards}
                                </div>
                              )}
                              
                              {/* Saved cards and likes - bottom left */}
                              <div className="film-card-stats-buttons">
                                {/* Saved cards button */}
                                <button
                                  className={`film-card-stat-btn film-card-saved-btn ${(savedCardsCounts[f.id] || 0) > 0 ? 'has-saved' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // Could navigate to saved cards view or show saved cards
                                  }}
                                  title={`${savedCardsCounts[f.id] || 0} cards saved`}
                                >
                                  <Heart 
                                    size={16} 
                                    fill={(savedCardsCounts[f.id] || 0) > 0 ? '#ef4444' : 'none'}
                                    stroke="#ef4444"
                                    strokeWidth={2}
                                  />
                                  <span className="film-card-stat-count">{savedCardsCounts[f.id] || 0}</span>
                                </button>
                                
                                {/* Like button */}
                                <button
                                  className={`film-card-stat-btn film-card-like-btn ${likeStatuses[f.id] ? 'liked' : ''}`}
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (!user?.uid) return;
                                    
                                    try {
                                      const result = await apiToggleLike(user.uid, f.id);
                                      setLikeStatuses(prev => ({ ...prev, [f.id]: result.liked }));
                                      setLikeCounts(prev => ({ ...prev, [f.id]: result.like_count }));
                                    } catch (error) {
                                      console.error('Failed to toggle like:', error);
                                    }
                                  }}
                                  title={`${likeCounts[f.id] || 0} likes`}
                                >
                                  <Star 
                                    size={16} 
                                    fill={likeStatuses[f.id] ? '#fbbf24' : 'none'}
                                    stroke="#fbbf24"
                                    strokeWidth={2}
                                  />
                                  <span className="film-card-stat-count">{likeCounts[f.id] || 0}</span>
                                </button>
                              </div>
                            </div>
                            
                            {/* Inline Detail Panel */}
                            <div className="film-detail-panel">
                              <div className="film-detail-grid">
                                <div className="film-detail-col-1">
                                  <h3 className="film-detail-title" title={f.title || f.id}>{f.title || f.id}</h3>
                                  
                                  {/* Framework Level Distribution */}
                                  {(() => {
                                    const levelStats = parseLevelStats(f.level_framework_stats);
                                    if (!levelStats || levelStats.length === 0) return null;
                                    
                                    // Get the first framework entry (or combine all)
                                    const firstEntry = levelStats[0];
                                    if (!firstEntry || !firstEntry.levels) return null;
                                    
                                    const sortedLevels = sortLevelsByDifficulty(firstEntry.levels);
                                    
                                    return (
                                      <div className="film-detail-level-distribution">
                                        <div className="film-detail-level-bar">
                                          {sortedLevels.map(([level, percent]) => {
                                            const colors = getLevelBadgeColors(level);
                                            return (
                                              <div
                                                key={level}
                                                className="film-detail-level-segment"
                                                style={{ 
                                                  width: `${percent}%`,
                                                  backgroundColor: colors.background
                                                }}
                                                title={`${level}: ${percent}%`}
                                              />
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                  })()}
                                  
                                  {/* SRS State Distribution */}
                                  {(() => {
                                    const srsDistribution = getSRSDistribution(f);
                                    const srsOrder: Array<keyof SRSDistribution> = ['none', 'new', 'again', 'hard', 'good', 'easy'];
                                    
                                    return (
                                      <div className="film-detail-srs-distribution">
                                        <div className="film-detail-srs-bar">
                                          {srsOrder.map(state => {
                                            const percent = srsDistribution[state] || 0;
                                            if (percent === 0) return null;
                                            
                                            return (
                                              <div
                                                key={state}
                                                className={`film-detail-srs-segment srs-${state}`}
                                                style={{ width: `${percent}%` }}
                                                title={`${state}: ${percent}%`}
                                              />
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                  })()}
                                  
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
                                  
                                  {/* Category Section */}
                                  <div className="film-detail-category-section">
                                    <button 
                                      className="category-scroll-btn category-scroll-btn-left"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const container = e.currentTarget.parentElement?.querySelector('.film-detail-categories');
                                        if (container) container.scrollBy({ left: -200, behavior: 'smooth' });
                                      }}
                                    >
                                      <img src={rightAngleIcon} alt="Previous" style={{ transform: 'rotate(180deg)', width: '12px', height: '12px' }} />
                                    </button>
                                    
                                    <div className="film-detail-categories">
                                      {f.categories && f.categories.length > 0 ? (
                                        f.categories.map((category) => (
                                          <span key={category.id} className="film-detail-category-item">
                                            {category.name}
                                          </span>
                                        ))
                                      ) : null}
                                    </div>
                                    
                                    <button 
                                      className="category-scroll-btn category-scroll-btn-right"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const container = e.currentTarget.parentElement?.querySelector('.film-detail-categories');
                                        if (container) container.scrollBy({ left: 200, behavior: 'smooth' });
                                      }}
                                    >
                                      <img src={rightAngleIcon} alt="Next" style={{ width: '12px', height: '12px' }} />
                                    </button>
                                  </div>
                                </div>
                                
                                <div className="film-detail-col-2">
                                  <button className="action-icon-btn" onClick={(e) => e.stopPropagation()}>
                                    <img src={saveHeartIcon} alt="Save" className="action-icon" />
                                  </button>
                                </div>
                                
                                {f.description && (
                                  <div className="film-detail-description-wrapper">
                                    <p className="film-detail-description" title={f.description}>
                                      {f.description}
                                    </p>
                                  </div>
                                )}
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
