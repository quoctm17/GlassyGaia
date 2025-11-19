import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiGetEpisodeDetail, apiFetchCardsForFilm } from "../../services/cfApi";
import type { EpisodeDetailDoc, LevelFrameworkStats, CardDoc } from "../../types";
import { sortLevelsByDifficulty } from "../../utils/levelSort";
import { ExternalLink, MoreHorizontal, Eye, Pencil, Trash2, Search, ChevronUp, ChevronDown } from "lucide-react";
import PortalDropdown from "../../components/PortalDropdown";
import toast from "react-hot-toast";
import { apiDeleteCard } from "../../services/cfApi";

export default function AdminEpisodeDetailPage() {
  const { contentSlug, episodeSlug } = useParams();
  const navigate = useNavigate();
  const [ep, setEp] = useState<EpisodeDetailDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingCards, setLoadingCards] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<CardDoc[]>([]);
  const [openMenuFor, setOpenMenuFor] = useState<{ id: string; anchor: HTMLElement; closing?: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  function parseEpisodeNumber(slug: string | undefined): number {
    if (!slug) return 1;
    let n = Number(String(slug).replace(/^e/i, ""));
    if (!n || Number.isNaN(n)) {
      const m = String(slug).match(/_(\d+)$/);
      n = m ? Number(m[1]) : 1;
    }
    return n || 1;
  }

  useEffect(() => {
    if (!contentSlug) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const num = parseEpisodeNumber(episodeSlug);
        const row = await apiGetEpisodeDetail({ filmSlug: contentSlug!, episodeNum: num });
        if (!mounted) return;
        setEp(row);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [contentSlug, episodeSlug]);

  // Load cards for the episode (optimized: fetch with higher limit and cache)
  useEffect(() => {
    if (!contentSlug || !episodeSlug) return;
    let mounted = true;
    (async () => {
      setLoadingCards(true);
      try {
        // Fetch with a reasonable high limit; API already returns subtitles in bulk
        const rows = await apiFetchCardsForFilm(contentSlug, episodeSlug, 2000);
        if (!mounted) return;
        setCards(rows);
      } catch {
        // ignore fetch errors
      } finally {
        setLoadingCards(false);
      }
    })();
    return () => { mounted = false; };
  }, [contentSlug, episodeSlug]);

  // R2 base is handled by URLs returned from API

  function parseLevelStats(raw: unknown): LevelFrameworkStats | null {
    if (!raw) return null;
    if (Array.isArray(raw)) return raw as LevelFrameworkStats;
    if (typeof raw === 'string') {
      try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr as LevelFrameworkStats : null; } catch { return null; }
    }
    return null;
  }
  const levelStats = useMemo(() => parseLevelStats(ep?.level_framework_stats as unknown), [ep?.level_framework_stats]);

  const pageSize = 10;
  const [page, setPage] = useState(1);

  // Cards search & sort
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<"id" | "start" | "end" | "duration" | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const filteredCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let rows = cards;
    if (q) {
      rows = rows.filter((c) => {
        const idPadded = String(c.id).padStart(4, "0");
        const start = String(c.start || "");
        const end = String(c.end || "");
        const dur = String(c.duration || Math.max(0, (c.end || 0) - (c.start || 0)));
        return (
          idPadded.includes(q) || start.includes(q) || end.includes(q) || dur.includes(q)
        );
      });
    }
    if (sortColumn) {
      rows = [...rows].sort((a, b) => {
        let cmp = 0;
        if (sortColumn === 'id') {
          const sa = String(a.id).padStart(4, '0');
          const sb = String(b.id).padStart(4, '0');
          cmp = sa < sb ? -1 : sa > sb ? 1 : 0;
        } else if (sortColumn === 'start') {
          cmp = (a.start || 0) - (b.start || 0);
        } else if (sortColumn === 'end') {
          cmp = (a.end || 0) - (b.end || 0);
        } else {
          const da = typeof a.duration === 'number' ? a.duration : Math.max(0, (a.end || 0) - (a.start || 0));
          const db = typeof b.duration === 'number' ? b.duration : Math.max(0, (b.end || 0) - (b.start || 0));
          cmp = da - db;
        }
        return sortDirection === 'asc' ? cmp : -cmp;
      });
    }
    return rows;
  }, [cards, searchQuery, sortColumn, sortDirection]);

  const handleSort = (col: "id" | "start" | "end" | "duration") => {
    if (sortColumn === col) setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortColumn(col); setSortDirection("asc"); }
  };

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2 className="admin-title">Episode Details: {episodeSlug}</h2>
        <div className="flex items-center gap-2">
          <button
            className="admin-btn primary flex items-center gap-2"
            onClick={() => navigate(`/admin/content/${encodeURIComponent(contentSlug || '')}/episodes/${encodeURIComponent(episodeSlug || '')}/update`)}
          >
            <Pencil className="w-4 h-4" />
            <span>Update</span>
          </button>
          <button className="admin-btn secondary" onClick={() => navigate(`/admin/content/${encodeURIComponent(contentSlug || '')}`)}>← Back</button>
        </div>
      </div>

      {loading && <div className="admin-info">Loading episode...</div>}
      {error && <div className="admin-error">{error}</div>}
      {ep && (
        <div className="space-y-4">
          {/* Episode Details Panel */}
          <div className="admin-panel space-y-3">
            <div className="text-sm font-semibold text-pink-300">Episode Information</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">Episode:</label>
                <span className="text-gray-200">{String(ep.episode_number).padStart(3,'0')}</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">Title:</label>
                <span className="text-gray-200">{ep.title || '-'}</span>
              </div>
            </div>
            {/* Cover and Video on same row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="w-32 text-sm text-gray-400">Cover:</label>
                  {ep.cover_url ? (
                    <a href={ep.cover_url + (ep.cover_url.includes('?') ? '&' : '?') + 'v=' + Date.now()} target="_blank" rel="noreferrer" className="admin-btn secondary inline-flex items-center gap-1">
                      <ExternalLink className="w-4 h-4" />
                      Open
                    </a>
                  ) : <span className="text-gray-200">-</span>}
                </div>
                {ep.cover_url && (
                  <img src={ep.cover_url + (ep.cover_url.includes('?') ? '&' : '?') + 'v=' + Date.now()} alt="cover" className="w-32 h-auto rounded border-2 border-pink-500 hover:border-pink-400 transition-colors shadow-[0_0_10px_rgba(236,72,153,0.4)]" />
                )}
              </div>
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">Full Video:</label>
                {ep.full_video_url ? (
                  <a
                    href={ep.full_video_url}
                    target="_blank"
                    rel="noreferrer"
                    className="admin-btn secondary inline-flex items-center gap-1"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Open
                  </a>
                ) : (
                  <span className="text-gray-200">-</span>
                )}
              </div>
            </div>

            {/* Full Audio below */}
            <div className="grid grid-cols-1 gap-3">
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">Full Audio:</label>
                {ep.full_audio_url ? (
                  <div className="flex-1">
                    <div className="audio-container">
                      <audio controls src={ep.full_audio_url} />
                    </div>
                  </div>
                ) : (
                  <span className="text-gray-200">-</span>
                )}
              </div>
            </div>
          </div>

          {/* Stats Panel */}
          <div className="admin-panel space-y-3">
            <div className="text-sm font-semibold text-pink-300">Statistics</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">Total Cards:</label>
                <span className="text-gray-200">{ep.num_cards ?? '-'}</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="w-32 text-sm text-gray-400">Avg Difficulty:</label>
                <span className="text-gray-200">{typeof ep.avg_difficulty_score === 'number' ? ep.avg_difficulty_score.toFixed(1) : '-'}</span>
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

      {/* Cards list for this episode */}
      <div className="admin-section-header mt-6">
        <div className="flex items-center justify-between w-full gap-3">
          <h3 className="admin-title">Cards</h3>
          <div className="relative w-full max-w-[420px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="admin-input !pl-10" placeholder="Search by #, start, end, duration" value={searchQuery} onChange={(e)=>{ setPage(1); setSearchQuery(e.target.value); }} />
          </div>
        </div>
      </div>
      {loadingCards && <div className="admin-info">Loading cards…</div>}
      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              <th className="cursor-pointer hover:bg-gray-800/60" onClick={() => handleSort('id')}>
                <div className="flex items-center gap-1">
                  <span>#</span>
                  {sortColumn === 'id' && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>
              <th className="cursor-pointer hover:bg-gray-800/60" onClick={() => handleSort('start')}>
                <div className="flex items-center gap-1">
                  <span>Start</span>
                  {sortColumn === 'start' && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>
              <th className="cursor-pointer hover:bg-gray-800/60" onClick={() => handleSort('end')}>
                <div className="flex items-center gap-1">
                  <span>End</span>
                  {sortColumn === 'end' && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>
              <th className="cursor-pointer hover:bg-gray-800/60" onClick={() => handleSort('duration')}>
                <div className="flex items-center gap-1">
                  <span>Duration</span>
                  {sortColumn === 'duration' && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>
              <th>Image</th>
              <th>Audio</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loadingCards && (
              Array.from({ length: pageSize }).map((_, i) => (
                <tr key={`sk-${i}`} className="animate-pulse">
                  <td className="opacity-60">••••</td>
                  <td className="opacity-60">...</td>
                  <td className="opacity-60">...</td>
                  <td className="opacity-60">...</td>
                  <td className="opacity-60">-</td>
                  <td className="opacity-60">-</td>
                  <td className="opacity-60">...</td>
                </tr>
              ))
            )}
            {filteredCards.slice((page-1)*pageSize, (page-1)*pageSize + pageSize).map((c) => {
              const idPadded = String(c.id).padStart(4,'0');
              // Determine if this is the first card (protect)
              const numericIds = cards.map(x => Number(String(x.id).replace(/^0+/,'')) || 0);
              const minNum = Math.min(...numericIds);
              const cNum = Number(String(c.id).replace(/^0+/,'')) || 0;
              const isFirstCard = cNum === minNum;
              return (
              <tr key={c.id} onClick={() => navigate(`/admin/content/${encodeURIComponent(contentSlug || '')}/${encodeURIComponent(episodeSlug || '')}/${idPadded}`)} style={{ cursor: 'pointer' }}>
                <td>{idPadded}</td>
                <td>{c.start}</td>
                <td>{c.end}</td>
                <td>{typeof c.duration === 'number' ? c.duration : Math.max(0, (c.end || 0) - (c.start || 0))}</td>
                <td>{c.image_url ? <a href={c.image_url} target="_blank" rel="noreferrer" className="admin-btn secondary" onClick={(e) => e.stopPropagation()}>Open</a> : '-'}</td>
                <td>{c.audio_url ? <a href={c.audio_url} target="_blank" rel="noreferrer" className="admin-btn secondary" onClick={(e) => e.stopPropagation()}>Open</a> : '-'}</td>
                <td onMouseDown={(e)=>e.stopPropagation()}>
                  <button
                    className="admin-btn secondary !px-2 !py-1"
                    title="Actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      const el = e.currentTarget as HTMLElement;
                      setOpenMenuFor(prev => {
                        if (prev && prev.id === c.id) {
                          const next = { ...prev, closing: true } as typeof prev;
                          setTimeout(() => setOpenMenuFor(null), 300);
                          return next;
                        }
                        return { id: c.id, anchor: el };
                      });
                    }}
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                  {openMenuFor?.id === c.id && openMenuFor.anchor && (
                    <PortalDropdown
                      anchorEl={openMenuFor.anchor}
                      align="center"
                      closing={openMenuFor.closing}
                      durationMs={300}
                      onClose={() => setOpenMenuFor(null)}
                      className="admin-dropdown-panel py-1"
                    >
                      <div className="admin-dropdown-item" onClick={(e) => { e.stopPropagation(); setOpenMenuFor(null); navigate(`/admin/content/${encodeURIComponent(contentSlug || '')}/${encodeURIComponent(episodeSlug || '')}/${idPadded}`); }}>
                        <Eye className="w-4 h-4" />
                        <span>View</span>
                      </div>
                      <div className="admin-dropdown-item" onClick={(e) => { e.stopPropagation(); setOpenMenuFor(null); navigate(`/admin/content/${encodeURIComponent(contentSlug || '')}/${encodeURIComponent(episodeSlug || '')}/${idPadded}/update`); }}>
                        <Pencil className="w-4 h-4" />
                        <span>Update</span>
                      </div>
                      {!isFirstCard && (
                        <div className="admin-dropdown-item" onClick={(e) => { e.stopPropagation(); setOpenMenuFor(null); setConfirmDelete({ id: idPadded }); }}>
                          <Trash2 className="w-4 h-4" />
                          <span>Delete</span>
                        </div>
                      )}
                    </PortalDropdown>
                  )}
                </td>
              </tr>
            );})}
            {filteredCards.length === 0 && !loadingCards && (
              <tr><td colSpan={7} className="admin-empty">No cards found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!loadingCards && filteredCards.length > 0 && (
        <div className="flex items-center justify-between mt-2">
          <div className="text-xs text-gray-400">
            Showing {(page-1)*pageSize + 1}-{Math.min(page*pageSize, filteredCards.length)} of {filteredCards.length}
          </div>
          <div className="flex gap-2">
            <button className="admin-btn secondary !py-1 !px-2" disabled={page<=1} onClick={() => setPage(p => Math.max(1, p-1))}>Prev</button>
            <button className="admin-btn secondary !py-1 !px-2" disabled={page*pageSize>=filteredCards.length} onClick={() => setPage(p => (p*pageSize<filteredCards.length ? p+1 : p))}>Next</button>
          </div>
        </div>
      )}

      {/* Confirm Delete Card Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !deleting && setConfirmDelete(null)}>
          <div
            className="bg-[#16111f] border-[3px] border-[#ec4899] rounded-xl p-6 max-w-md w-full mx-4 shadow-[0_0_0_2px_rgba(147,51,234,0.25)_inset,0_0_24px_rgba(236,72,153,0.35)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-[#f5d0fe] mb-4">Xác nhận xoá Card</h3>
            <p className="text-[#f5d0fe] mb-2">Bạn có chắc muốn xoá Card: <span className="text-[#f9a8d4] font-semibold">#{confirmDelete.id}</span>?</p>
            <p className="text-sm text-[#e9d5ff] mb-6">Thao tác này sẽ xoá media liên quan của card.</p>
            <div className="flex gap-3 justify-end">
              <button className="admin-btn secondary" onClick={() => setConfirmDelete(null)} disabled={deleting}>Huỷ</button>
              <button
                className="admin-btn primary"
                disabled={deleting}
                onClick={async () => {
                  if (!contentSlug || !episodeSlug) return;
                  setDeleting(true);
                  try {
                    const res = await apiDeleteCard({ filmSlug: contentSlug, episodeSlug: episodeSlug, cardId: confirmDelete.id });
                    if ('error' in res) { toast.error(res.error); return; }
                    setCards(prev => prev.filter(c => String(c.id).padStart(4,'0') !== confirmDelete.id));
                    toast.success(`Đã xoá card #${confirmDelete.id} (Media: ${res.media_deleted}${res.media_errors.length ? ', Lỗi: ' + res.media_errors.length : ''})`);
                    setConfirmDelete(null);
                  } catch (e) { toast.error((e as Error).message); }
                  finally { setDeleting(false); }
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
