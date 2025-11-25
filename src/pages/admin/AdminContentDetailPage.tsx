import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGetFilm, apiListEpisodes, apiDeleteEpisode, apiCalculateStats } from '../../services/cfApi';
import type { FilmDoc, LevelFrameworkStats } from '../../types';
import { langLabel, countryCodeForLang } from '../../utils/lang';
import { sortLevelsByDifficulty } from '../../utils/levelSort';
import { ExternalLink, PlusCircle, Eye, Pencil, Trash2, MoreHorizontal, Search, ChevronUp, ChevronDown, Film, Clapperboard, Book as BookIcon, AudioLines } from 'lucide-react';
import PortalDropdown from '../../components/PortalDropdown';
import ProgressBar from '../../components/ProgressBar';
import toast from 'react-hot-toast';
import { CONTENT_TYPE_LABELS, type ContentType } from '../../types/content';

export default function AdminContentDetailPage() {
  const { contentSlug } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<FilmDoc | null>(null);
  const [languages, setLanguages] = useState<string[]>([]);
  const [episodes, setEpisodes] = useState<Array<{ episode_number: number; title: string | null; slug: string; cover_url: string | null; full_audio_url: string | null; full_video_url: string | null }>>([]);
  const [loadingItem, setLoadingItem] = useState(false);
  const [loadingEpisodes, setLoadingEpisodes] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openMenuFor, setOpenMenuFor] = useState<{ slug: string; anchor: HTMLElement; closing?: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ slug: string; title: string; episode_number: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deletionProgress, setDeletionProgress] = useState<{ stage: string; details: string } | null>(null);
  const [deletionPercent, setDeletionPercent] = useState(0);

  useEffect(() => {
    if (!contentSlug) return;
    let mounted = true;
    (async () => {
      setLoadingItem(true);
      try {
        const f = await apiGetFilm(contentSlug); // still film API for content item
        if (!mounted) return;
        setItem(f);
        console.log('[AdminContentDetailPage] Film data:', f);
        const subs = Array.isArray(f?.available_subs) ? f!.available_subs.filter(Boolean) : [];
        console.log('[AdminContentDetailPage] Available Subs from film:', subs);
        const langList = subs.length ? subs : (f?.main_language ? [f.main_language] : []);
        console.log('[AdminContentDetailPage] Final languages list:', langList);
        setLanguages(langList);
      } catch (e) { setError((e as Error).message); }
      finally { setLoadingItem(false); }
    })();
    return () => { mounted = false; };
  }, [contentSlug]);

  useEffect(() => {
    if (!contentSlug) return;
    let mounted = true;
    (async () => {
      setLoadingEpisodes(true);
      try {
        const rows = await apiListEpisodes(contentSlug);
        if (!mounted) return;
        setEpisodes(rows);
      } catch (e) { setError((e as Error).message); }
      finally { setLoadingEpisodes(false); }
    })();
    return () => { mounted = false; };
  }, [contentSlug]);
  
  const r2Base = (import.meta.env.VITE_R2_PUBLIC_BASE || '').replace(/\/$/, '');
  const coverDisplayUrl = useMemo(() => {
    if (!item) return '';
    let url = item.cover_url || '';
    if (url.startsWith('/') && r2Base) url = r2Base + url;
    if (!url && item.id) {
      const path = `/items/${item.id}/cover_image/cover.jpg`;
      url = r2Base ? r2Base + path : path;
    }
    // Add cache-busting query string using updated_at or Date.now()
    // Use Date.now() to force reload after update
    if (url) {
      url += (url.includes('?') ? '&' : '?') + 'v=' + Date.now();
    }
    return url;
  }, [item, r2Base]);

  const coverLandscapeDisplayUrl = useMemo(() => {
    if (!item) return '';
    let url = (item as {cover_landscape_url?: string}).cover_landscape_url || '';
    if (url.startsWith('/') && r2Base) url = r2Base + url;
    if (!url && item.id) {
      const path = `/items/${item.id}/cover_image/cover_landscape.jpg`;
      url = r2Base ? r2Base + path : path;
    }
    if (url) {
      url += (url.includes('?') ? '&' : '?') + 'v=' + Date.now();
    }
    return url;
  }, [item, r2Base]);

  function parseLevelStats(raw: unknown): LevelFrameworkStats | null {
    if (!raw) return null;
    if (Array.isArray(raw)) return raw as LevelFrameworkStats;
    if (typeof raw === 'string') {
      try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr as LevelFrameworkStats : null; } catch { return null; }
    }
    return null;
  }
  const levelStats = useMemo(() => parseLevelStats(item?.level_framework_stats as unknown), [item?.level_framework_stats]);

  // Calculate total languages: main_language + available_subs (deduplicated)
  const totalLanguages = useMemo(() => {
    const langs = new Set<string>();
    if (item?.main_language) langs.add(item.main_language);
    languages.forEach(lang => langs.add(lang));
    return langs.size;
  }, [item?.main_language, languages]);

  const pageSize = 10;
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<"num" | "title" | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const filteredEpisodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let rows = episodes;
    if (q) {
      rows = rows.filter(ep => {
        const num = String(ep.episode_number).padStart(3,'0');
        const title = (ep.title || '').toLowerCase();
        return num.includes(q) || title.includes(q);
      });
    }
    if (sortColumn) {
      rows = [...rows].sort((a, b) => {
        let cmp = 0;
        if (sortColumn === 'num') {
          cmp = a.episode_number - b.episode_number;
        } else {
          const ta = (a.title || '').toLowerCase();
          const tb = (b.title || '').toLowerCase();
          cmp = ta < tb ? -1 : ta > tb ? 1 : 0;
        }
        return sortDirection === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  }, [episodes, searchQuery, sortColumn, sortDirection]);

  const handleSort = (col: "num" | "title") => {
    if (sortColumn === col) setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortColumn(col); setSortDirection('asc'); }
  };
  return (
    <div className="admin-section">
      <div className="admin-section-header flex items-center gap-2">
        <h2 className="admin-title">Content: {contentSlug}</h2>
        <div className="flex gap-2 ml-auto">
          <button
            className="admin-btn primary flex items-center gap-2"
            onClick={() => navigate(`/admin/update?slug=${encodeURIComponent(contentSlug!)}`)}
          >
            <Pencil className="w-4 h-4" />
            <span>Update</span>
          </button>
          <button className="admin-btn secondary" onClick={() => navigate('/admin/content')}>← Back</button>
        </div>
      </div>
      {loadingItem && <div className="admin-info">Loading content...</div>}
      {error && <div className="admin-error">{error}</div>}
      {item && (
        <div className="space-y-4">
          {/* Content Details Panel */}
          <div className="admin-panel space-y-3">
            <div className="text-sm font-semibold text-pink-300">Content Information</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">Title:</label>
                <span className="text-gray-200">{item.title || '-'}</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">Type:</label>
                <span className="inline-flex items-center gap-1.5 text-gray-200">
                  {(() => {
                    const t = (item.type || '').toLowerCase();
                    if (t === 'movie') return <Film className="w-4 h-4 text-pink-300" />;
                    if (t === 'series') return <Clapperboard className="w-4 h-4 text-pink-300" />;
                    if (t === 'book') return <BookIcon className="w-4 h-4 text-pink-300" />;
                    if (t === 'audio') return <AudioLines className="w-4 h-4 text-pink-300" />;
                    return null;
                  })()}
                  <span>{(CONTENT_TYPE_LABELS[(item.type || '') as ContentType] || item.type) || '-'}</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">Main Language:</label>
                {item.main_language ? (
                  <span className="inline-flex items-center gap-1 text-gray-200">
                    <span className={`fi fi-${countryCodeForLang(item.main_language)} w-5 h-3.5`}></span>
                    <span>{langLabel(item.main_language)}</span>
                  </span>
                ) : <span className="text-gray-200">-</span>}
              </div>
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">Release Year:</label>
                <span className="text-gray-200">{item.release_year || '-'}</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">Total Episodes:</label>
                <span className="text-gray-200">{Number(item.total_episodes) > 0 ? item.total_episodes : '-'}</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">Total Languages:</label>
                <span className="text-gray-200">{totalLanguages}</span>
              </div>
            </div>
            <div>
              <label className="w-32 text-sm text-gray-400 block mb-3">Available Subs:</label>
              {languages.length ? (
                <div className="inline-flex flex-wrap gap-2">
                  {languages.map(l => {
                    // Determine if this language has a variant label
                    const baseLabel = langLabel(l);
                    const hasVariant = l === 'es_la' || l === 'es_es' || l === 'pt_br' || l === 'pt_pt' || l === 'fr_ca' || l === 'zh_trad';
                    const variantMap: Record<string, string> = {
                      es_la: 'Latin America',
                      es_es: 'Spain',
                      pt_br: 'Brazil',
                      pt_pt: 'Portugal',
                      fr_ca: 'Canada',
                      zh_trad: 'Traditional'
                    };
                    return (
                      <span key={l} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border-2 border-pink-500/40 bg-[#1a0f24] text-xs text-pink-100 shadow-[0_0_10px_rgba(236,72,153,0.25)] hover:border-pink-400/60 transition-colors">
                        <span className={`fi fi-${countryCodeForLang(l)} w-5 h-3.5`}></span>
                        <span>{baseLabel}</span>
                        {hasVariant && <span className="text-[10px] text-pink-300/70">({variantMap[l]})</span>}
                      </span>
                    );
                  })}
                </div>
              ) : <span className="text-gray-200">-</span>}
            </div>
            <div>
              <label className="w-32 text-sm text-gray-400">Description:</label>
              <div className="text-gray-200 mt-1">{item.description || '-'}</div>
            </div>
            {/* Cover images side-by-side */}
            {(coverDisplayUrl || coverLandscapeDisplayUrl) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {coverDisplayUrl && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-400">Cover (Portrait):</label>
                      <a href={coverDisplayUrl} target="_blank" rel="noreferrer" className="admin-btn secondary inline-flex items-center gap-1">
                        <ExternalLink className="w-4 h-4" />
                        Open
                      </a>
                    </div>
                    <img src={coverDisplayUrl} alt="cover" className="w-32 h-auto rounded border-2 border-pink-500 hover:border-pink-400 transition-colors shadow-[0_0_10px_rgba(236,72,153,0.4)]" />
                  </div>
                )}
                {coverLandscapeDisplayUrl && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-400">Cover (Landscape):</label>
                      <a href={coverLandscapeDisplayUrl} target="_blank" rel="noreferrer" className="admin-btn secondary inline-flex items-center gap-1">
                        <ExternalLink className="w-4 h-4" />
                        Open
                      </a>
                    </div>
                    <img src={coverLandscapeDisplayUrl} alt="cover landscape" className="w-48 h-auto rounded border-2 border-pink-500 hover:border-pink-400 transition-colors shadow-[0_0_10px_rgba(236,72,153,0.4)]" />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Stats Panel */}
          <div className="admin-panel space-y-3">
            <div className="text-sm font-semibold text-pink-300">Statistics</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">Total Cards:</label>
                <span className="text-gray-200">{item.num_cards ?? '-'}</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">Avg Difficulty:</label>
                <span className="text-gray-200">{typeof item.avg_difficulty_score === 'number' ? item.avg_difficulty_score.toFixed(1) : '-'}</span>
              </div>
            </div>
            {levelStats && levelStats.length > 0 && (
              <div>
                <div className="text-sm text-gray-400 mb-2">Level Distribution:</div>
                <div className="space-y-2">
                  {levelStats.map((entry, idx) => (
                    <div key={idx} className="bg-[#1a0f24] rounded-lg p-3 border-2 border-pink-500/50 shadow-[0_0_12px_rgba(236,72,153,0.25)]">
                      <div className="text-sm text-pink-200 mb-2">{entry.framework}{entry.language ? ` · ${entry.language}` : ''}</div>
                      <div className="flex flex-wrap gap-2">
                        {sortLevelsByDifficulty(entry.levels).map(([lvl, pct]) => (
                          <div key={lvl} className="text-xs bg-gray-700/60 px-2 py-1 rounded">
                            <span className="text-gray-300">{lvl}:</span> <span className="text-pink-300">{pct}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-8 mb-4 flex items-center justify-between gap-3">
        {loadingEpisodes ? <div className="admin-info">Loading episodes…</div> : <div />}
        <div className="flex items-center gap-3 ml-auto">
          <div className="relative w-[360px] max-w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="admin-input !pl-10" placeholder="Search by # or title" value={searchQuery} onChange={(e)=>{ setPage(1); setSearchQuery(e.target.value); }} />
          </div>
          <button className="admin-btn primary flex items-center gap-2" onClick={() => navigate(`/admin/content/${encodeURIComponent(contentSlug!)}/add-episode`)}>
            <PlusCircle className="w-4 h-4" />
            <span>Add Episode</span>
          </button>
        </div>
      </div>

      {/* Episodes list */}
      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              <th className="cursor-pointer hover:bg-gray-800/60" onClick={() => handleSort('num')}>
                <div className="flex items-center gap-1">
                  <span>#</span>
                  {sortColumn === 'num' && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>
              <th className="cursor-pointer hover:bg-gray-800/60" onClick={() => handleSort('title')}>
                <div className="flex items-center gap-1">
                  <span>Title</span>
                  {sortColumn === 'title' && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>
              <th>Cover</th>
              <th>Full Audio</th>
              <th>Full Video</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredEpisodes.slice((page-1)*pageSize, (page-1)*pageSize + pageSize).map(ep => (
              <tr key={ep.slug} onClick={() => navigate(`/admin/content/${encodeURIComponent(contentSlug!)}/episodes/${ep.slug}`)} style={{ cursor: 'pointer' }}>
                <td>{String(ep.episode_number).padStart(3,'0')}</td>
                <td className="admin-cell-ellipsis" title={ep.title || ''}>{ep.title || '-'}</td>
                <td>{ep.cover_url ? <a href={ep.cover_url} target="_blank" rel="noreferrer" className="admin-btn secondary" onClick={e => e.stopPropagation()}>Open</a> : '-'}</td>
                <td>{ep.full_audio_url ? <a href={ep.full_audio_url} target="_blank" rel="noreferrer" className="admin-btn secondary" onClick={e => e.stopPropagation()}>Open</a> : '-'}</td>
                <td>{ep.full_video_url ? <a href={ep.full_video_url} target="_blank" rel="noreferrer" className="admin-btn secondary" onClick={e => e.stopPropagation()}>Open</a> : '-'}</td>
                <td onMouseDown={(e)=>e.stopPropagation()}>
                  <button
                    className="admin-btn secondary !px-2 !py-1"
                    title="Actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      const el = e.currentTarget as HTMLElement;
                      setOpenMenuFor(prev => {
                        if (prev && prev.slug === ep.slug) {
                          const next = { ...prev, closing: true } as typeof prev;
                          setTimeout(() => setOpenMenuFor(null), 300);
                          return next;
                        }
                        return { slug: ep.slug, anchor: el };
                      });
                    }}
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                  {openMenuFor?.slug === ep.slug && openMenuFor.anchor && (
                    <PortalDropdown
                      anchorEl={openMenuFor.anchor}
                      align="center"
                      closing={openMenuFor.closing}
                      durationMs={300}
                      onClose={() => setOpenMenuFor(null)}
                      className="admin-dropdown-panel py-1"
                    >
                      <div className="admin-dropdown-item" onClick={(e) => { e.stopPropagation(); setOpenMenuFor(null); navigate(`/admin/content/${encodeURIComponent(contentSlug!)}/episodes/${ep.slug}`); }}>
                        <Eye className="w-4 h-4" />
                        <span>View</span>
                      </div>
                      <div className="admin-dropdown-item" onClick={(e) => { e.stopPropagation(); setOpenMenuFor(null); navigate(`/admin/content/${encodeURIComponent(contentSlug!)}/episodes/${ep.slug}/update`); }}>
                        <Pencil className="w-4 h-4" />
                        <span>Update</span>
                      </div>
                      {ep.episode_number > 1 && (
                        <div className="admin-dropdown-item" onClick={(e) => { e.stopPropagation(); setOpenMenuFor(null); setConfirmDelete({ slug: ep.slug, title: ep.title || ep.slug, episode_number: ep.episode_number }); }}>
                          <Trash2 className="w-4 h-4" />
                          <span>Delete</span>
                        </div>
                      )}
                    </PortalDropdown>
                  )}
                </td>
              </tr>
            ))}
            {filteredEpisodes.length === 0 && !loadingEpisodes && (
              <tr><td colSpan={6} className="admin-empty">No episodes found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!loadingEpisodes && filteredEpisodes.length > 0 && (
        <div className="flex items-center justify-between mt-2">
          <div className="text-xs text-gray-400">
            Showing {(page-1)*pageSize + 1}-{Math.min(page*pageSize, filteredEpisodes.length)} of {filteredEpisodes.length}
          </div>
          <div className="flex gap-2">
            <button className="admin-btn secondary !py-1 !px-2" disabled={page<=1} onClick={() => setPage(p => Math.max(1, p-1))}>Prev</button>
            <button className="admin-btn secondary !py-1 !px-2" disabled={page*pageSize>=filteredEpisodes.length} onClick={() => setPage(p => (p*pageSize<filteredEpisodes.length ? p+1 : p))}>Next</button>
          </div>
        </div>
      )}

      {/* Confirm Delete Episode Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !deleting && setConfirmDelete(null)}>
          <div
            className="bg-[#16111f] border-[3px] border-[#ec4899] rounded-xl p-6 max-w-md w-full mx-4 shadow-[0_0_0_2px_rgba(147,51,234,0.25)_inset,0_0_24px_rgba(236,72,153,0.35)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-[#f5d0fe] mb-4">Xác nhận xoá Episode</h3>
            <p className="text-[#f5d0fe] mb-2">Bạn có chắc muốn xoá:</p>
            <p className="text-[#f9a8d4] font-semibold mb-4">"{confirmDelete.title}" (#{String(confirmDelete.episode_number).padStart(3,'0')})</p>
            <p className="text-sm text-[#e9d5ff] mb-6">Thao tác này sẽ xoá toàn bộ Cards và Media thuộc episode này. Không thể hoàn tác!</p>
            {deletionProgress && (
              <div className="mb-4 p-3 bg-[#241530] border-2 border-[#f472b6] rounded-lg">
                <div className="text-sm font-semibold text-[#f9a8d4] mb-2">{deletionProgress.stage}</div>
                <div className="text-xs text-[#e9d5ff] mb-2">{deletionProgress.details}</div>
                <ProgressBar percent={deletionPercent} />
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button className="admin-btn secondary" onClick={() => setConfirmDelete(null)} disabled={deleting}>Huỷ</button>
              <button
                className="admin-btn primary"
                disabled={deleting}
                onClick={async () => {
                  if (!contentSlug) return;
                  setDeleting(true);
                  setDeletionPercent(10);
                  let timer: number | undefined;
                  let slowTimer: number | undefined;
                  setDeletionProgress({ stage: 'Đang xoá...', details: 'Đang xử lý yêu cầu xoá episode' });
                  try {
                    // Phase 1: fast ramp to 70%
                    timer = window.setInterval(() => {
                      setDeletionPercent((p) => (p < 70 ? p + 4 : p));
                    }, 220);
                    setTimeout(() => {
                      // Phase 2: slower ramp 70% -> 85%
                      if (timer) window.clearInterval(timer);
                      timer = window.setInterval(() => {
                        setDeletionPercent((p) => (p < 85 ? p + 2 : p));
                      }, 500);
                    }, 3000);
                    // Phase 3: indeterminate finalization
                    slowTimer = window.setInterval(() => {
                      setDeletionPercent((p) => (p >= 85 && p < 95 ? p + 1 : p));
                    }, 4000);
                    
                    setDeletionProgress({ stage: 'Đang xoá database...', details: 'Xoá Cards, subtitles và metadata' });
                    const res = await apiDeleteEpisode({ filmSlug: contentSlug, episodeNum: confirmDelete.episode_number });
                    
                    if (timer) window.clearInterval(timer);
                    if (slowTimer) window.clearInterval(slowTimer);
                    
                    if ('error' in res) {
                      toast.error(res.error);
                      setDeletionProgress(null);
                      setDeletionPercent(0);
                      return;
                    }
                    
                    setDeletionPercent(100);
                    setDeletionProgress({ stage: 'Hoàn tất', details: `Đã xoá ${res.cards_deleted} cards, ${res.media_deleted} media files` });
                    
                    const remainingEpisodes = episodes.filter(e => e.slug !== confirmDelete.slug);
                    setEpisodes(remainingEpisodes);
                    
                    // Recalculate statistics for all remaining episodes
                    if (remainingEpisodes.length > 0) {
                      try {
                        for (const ep of remainingEpisodes) {
                          try {
                            const statsRes = await apiCalculateStats({ filmSlug: contentSlug, episodeNum: ep.episode_number });
                            if ('error' in statsRes) {
                              console.warn(`Failed to recalculate stats for episode ${ep.episode_number}:`, statsRes.error);
                            }
                          } catch (epStatsErr) {
                            console.warn(`Stats error for episode ${ep.episode_number}:`, epStatsErr);
                          }
                        }
                      } catch (statsErr) {
                        console.warn('Stats recalculation error:', statsErr);
                      }
                    }
                    
                    setTimeout(() => {
                      toast.success(`Đã xoá Episode (Cards: ${res.cards_deleted}, Media: ${res.media_deleted}${res.media_errors.length ? ', Lỗi: ' + res.media_errors.length : ''})`);
                      setConfirmDelete(null);
                      setDeletionProgress(null);
                      setDeletionPercent(0);
                    }, 600);
                  } catch (e) {
                    toast.error((e as Error).message);
                    setDeletionProgress(null);
                    setDeletionPercent(0);
                  } finally {
                    if (timer) window.clearInterval(timer);
                    if (slowTimer) window.clearInterval(slowTimer);
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? 'Đang xoá...' : 'Xoá'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
