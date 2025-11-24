import { useEffect, useState, useMemo } from 'react';
import { apiListItems, apiGetFilm, apiDeleteItem } from '../../services/cfApi';
import { useUser } from "../../context/UserContext";
import { getAvailableMainLanguages } from "../../services/firestore";
import type { FilmDoc } from '../../types';
import { useNavigate } from 'react-router-dom';
import { canonicalizeLangCode, countryCodeForLang, langLabel } from '../../utils/lang';
import { PlusCircle, Eye, Pencil, Trash2, ChevronDown, MoreHorizontal, Filter, Search, ChevronUp, Film, Music, Book, Tv } from 'lucide-react';
import toast from 'react-hot-toast';
import LanguageTag from '../../components/LanguageTag';
import PortalDropdown from '../../components/PortalDropdown';
import CustomSelect from '../../components/CustomSelect';
import FlagDisplay from '../../components/FlagDisplay';
import ProgressBar from '../../components/ProgressBar';
import Pagination from '../../components/Pagination';

export default function AdminContentListPage() {
  const { preferences, setMainLanguage } = useUser();
  const [rows, setRows] = useState<FilmDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const [openMenuFor, setOpenMenuFor] = useState<{ id: string; anchor: HTMLElement; closing?: boolean } | null>(null);
  const [openSubsFor, setOpenSubsFor] = useState<{ id: string; anchor: HTMLElement; closing?: boolean } | null>(null);
  const [origFilter, setOrigFilter] = useState<'all' | 'original' | 'non-original'>('all');
  const [confirmDelete, setConfirmDelete] = useState<{ slug: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deletionProgress, setDeletionProgress] = useState<{ stage: string; details: string } | null>(null);
  const [deletionPercent, setDeletionPercent] = useState(0);
  // Filters dropdown (portal) state
  const [filterDropdown, setFilterDropdown] = useState<{ anchor: HTMLElement; closing?: boolean } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [langFilter, setLangFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [sortColumn, setSortColumn] = useState<'slug' | 'title' | 'type' | 'main_language' | 'release_year' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        // Fetch base list first
        const items = await apiListItems();
        if (!mounted) return;

        // Enrich with details (available_subs, cover, etc.) similar to ContentMoviePage
        const detailed = await Promise.all(
          items.map(async (f) => {
            const d = await apiGetFilm(f.id).catch(() => null);
            return d
              ? { ...f, ...d, available_subs: Array.isArray(d.available_subs) ? d.available_subs : (Array.isArray(f.available_subs) ? f.available_subs : []) }
              : f;
          })
        );
        if (!mounted) return;
        setRows(detailed);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Close any open popovers when clicking outside
  // Removed global mousedown close so toggle works properly via portal logic

  // Helper: Get type icon
  const getTypeIcon = (type: string | undefined) => {
    const t = (type || 'movie').toLowerCase();
    if (t === 'movie' || t === 'film') return <Film className="w-4 h-4" />;
    if (t === 'series' || t === 'tv') return <Tv className="w-4 h-4" />;
    if (t === 'music') return <Music className="w-4 h-4" />;
    if (t === 'book') return <Book className="w-4 h-4" />;
    return <Film className="w-4 h-4" />;
  };

  // Get unique values for filters
  const uniqueLangs = useMemo(() => Array.from(new Set(rows.map(r => r.main_language).filter(Boolean))), [rows]);
  const uniqueTypes = useMemo(() => Array.from(new Set(rows.map(r => r.type).filter(Boolean))), [rows]);
  const uniqueYears = useMemo(() => Array.from(new Set(rows.map(r => r.release_year).filter(Boolean))).sort((a, b) => (b as number) - (a as number)), [rows]);

  // Prepare options for CustomSelect
  const origOptions = [
    { value: 'all', label: 'All' },
    { value: 'original', label: 'Original' },
    { value: 'non-original', label: 'Non-original' },
  ];
  const langOptions = [
    { value: 'all', label: 'All Languages' },
    ...uniqueLangs.map(l => ({ value: l as string, label: `${langLabel(l as string)} (${l})`, icon: <FlagDisplay lang={l as string} /> })),
  ];
  const typeOptions = [
    { value: 'all', label: 'All Types' },
    ...uniqueTypes.map(t => {
      const icon = getTypeIcon(t as string);
      return { value: t as string, label: (t as string), icon };
    }),
  ];
  const yearOptions = [
    { value: 'all', label: 'All Years' },
    ...uniqueYears.map(y => ({ value: String(y), label: String(y) })),
  ];

  // Apply filters + search + sort
  let filteredRows = rows.filter((f) => {
    // Original filter
    if (origFilter !== 'all') {
      const flag = (typeof f.is_original === 'boolean') ? f.is_original : true;
      if (origFilter === 'original' && !flag) return false;
      if (origFilter === 'non-original' && flag) return false;
    }
    // Language filter
    if (langFilter !== 'all' && f.main_language !== langFilter) return false;
    // Type filter
    if (typeFilter !== 'all' && f.type !== typeFilter) return false;
    // Year filter
    if (yearFilter !== 'all' && String(f.release_year) !== yearFilter) return false;
    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchSlug = f.id?.toLowerCase().includes(q);
      const matchTitle = f.title?.toLowerCase().includes(q);
      const matchType = f.type?.toLowerCase().includes(q);
      if (!matchSlug && !matchTitle && !matchType) return false;
    }
    return true;
  });

  // Apply sorting
  if (sortColumn) {
    filteredRows = [...filteredRows].sort((a, b) => {
      let valA: string | number | undefined;
      let valB: string | number | undefined;
      if (sortColumn === 'slug') {
        valA = a.id;
        valB = b.id;
      } else {
        valA = a[sortColumn];
        valB = b[sortColumn];
      }
      if (sortColumn === 'release_year') {
        valA = valA || 0;
        valB = valB || 0;
      } else {
        valA = String(valA || '').toLowerCase();
        valB = String(valB || '').toLowerCase();
      }
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }

  const handleSort = (column: typeof sortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1); // 1-based

  // Reset to first page whenever search or any filter changes to avoid empty page view.
  useEffect(() => {
    setPage(1);
  }, [searchQuery, origFilter, langFilter, typeFilter, yearFilter]);

  // Clamp page if current page exceeds total pages after filtering.
  const totalPages = useMemo(() => Math.max(1, Math.ceil(filteredRows.length / pageSize)), [filteredRows.length, pageSize]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages, page]);
  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <div className="flex items-center justify-between gap-3 w-full">
          {/* Left: Title + Search aligned to left */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <h2 className="admin-title shrink-0">Content</h2>
            <div className="relative flex-1 max-w-[680px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by slug, title, or type..."
                className="admin-input !pl-10 w-full"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          {/* Right: Filters then Create aligned to right */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="admin-btn secondary flex items-center gap-2"
              onClick={(e) => {
                e.stopPropagation();
                const el = e.currentTarget as HTMLElement;
                setFilterDropdown(prev => {
                  if (prev && prev.anchor === el) {
                    const next = { ...prev, closing: true } as typeof prev;
                    setTimeout(() => setFilterDropdown(null), 300);
                    return next;
                  }
                  return { anchor: el };
                });
              }}
            >
              <Filter className="w-4 h-4" />
              <span>Filters</span>
              {filterDropdown && !filterDropdown.closing ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
            <button
              type="button"
              className="admin-btn primary flex items-center gap-2"
              onClick={() => navigate('/admin/create')}
              title="Create new content"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Create</span>
            </button>
          </div>
        </div>
        {/* Filters Dropdown via Portal (does not shift table) */}
        {filterDropdown?.anchor && (
          <PortalDropdown
            anchorEl={filterDropdown.anchor}
            align="right"
            minWidth={680}
            closing={filterDropdown.closing}
            durationMs={300}
            onClose={() => setFilterDropdown(null)}
            className="admin-dropdown-panel p-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Original</label>
                <CustomSelect
                  value={origFilter}
                  options={origOptions}
                  onChange={(v) => setOrigFilter(v as 'all' | 'original' | 'non-original')}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Language</label>
                <CustomSelect
                  value={langFilter}
                  options={langOptions}
                  onChange={setLangFilter}
                  searchable
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Type</label>
                <CustomSelect
                  value={typeFilter}
                  options={typeOptions}
                  onChange={setTypeFilter}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Release Year</label>
                <CustomSelect
                  value={yearFilter}
                  options={yearOptions}
                  onChange={setYearFilter}
                  allowClear
                />
              </div>
            </div>
          </PortalDropdown>
        )}
      </div>
      {loading && <div className="admin-info">Loading...</div>}
      {error && <div className="admin-error">{error}</div>}
      <div className="admin-table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              <th className="w-12">#</th>
              <th className="cursor-pointer hover:bg-gray-800/60" onClick={() => handleSort('slug')}>
                <div className="flex items-center gap-1">
                  <span>Slug</span>
                  {sortColumn === 'slug' && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>
              <th className="cursor-pointer hover:bg-gray-800/60" onClick={() => handleSort('title')}>
                <div className="flex items-center gap-1">
                  <span>Title</span>
                  {sortColumn === 'title' && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>
              <th className="cursor-pointer hover:bg-gray-800/60" onClick={() => handleSort('type')}>
                <div className="flex items-center gap-1">
                  <span>Type</span>
                  {sortColumn === 'type' && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>
              <th className="cursor-pointer hover:bg-gray-800/60" onClick={() => handleSort('main_language')}>
                <div className="flex items-center gap-1">
                  <span>Main language</span>
                  {sortColumn === 'main_language' && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>
              <th className="cursor-pointer hover:bg-gray-800/60" onClick={() => handleSort('release_year')}>
                <div className="flex items-center gap-1">
                  <span>Release</span>
                  {sortColumn === 'release_year' && (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </div>
              </th>
              <th>Subs</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 && !loading && !error && (
              <tr>
                <td colSpan={8} className="admin-empty">No content found</td>
              </tr>
            )}
            {filteredRows.slice((page-1)*pageSize, (page-1)*pageSize + pageSize).map((f, idx) => {
              const mainCanon = f.main_language ? (canonicalizeLangCode(f.main_language) || f.main_language.toLowerCase()) : undefined;
              const subs = Array.from(
                new Set(
                  (f.available_subs || [])
                    .map((s) => canonicalizeLangCode(s) || s.toLowerCase())
                    .filter((s) => s && s !== mainCanon)
                )
              );
              return (
                <tr key={f.id} onClick={() => navigate(`/admin/content/${encodeURIComponent(f.id)}`)} style={{ cursor:'pointer' }}>
                  <td className="text-gray-400">{(page-1)*pageSize + idx + 1}</td>
                  <td className="admin-cell-ellipsis" title={f.id}>{f.id}</td>
                  <td className="admin-cell-ellipsis" title={f.title || ''}>{f.title || '-'}</td>
                  <td>
                    <div className="inline-flex items-center gap-2">
                      {getTypeIcon(f.type)}
                      <span>{f.type || '-'}</span>
                    </div>
                  </td>
                  <td>{f.main_language ? <LanguageTag code={f.main_language} /> : '-'}</td>
                  <td>{f.release_year || '-'}</td>
                  <td>
                    {subs.length > 0 ? (
                      <div className="inline-flex items-center gap-2" onMouseDown={(e)=>e.stopPropagation()}>
                        <span className="text-sm">{subs.length} Subs</span>
                        <button
                          type="button"
                          className="admin-btn secondary !px-2 !py-1"
                          title="View subtitle languages"
                          onClick={(e) => {
                            e.stopPropagation();
                            const el = e.currentTarget as HTMLElement;
                            setOpenSubsFor(prev => {
                              if (prev && prev.id === f.id) {
                                // trigger close with animation, then unmount after duration
                                const next = { ...prev, closing: true } as typeof prev;
                                setTimeout(() => setOpenSubsFor(null), 300);
                                return next;
                              }
                              return { id: f.id, anchor: el };
                            });
                            setOpenMenuFor(null);
                          }}
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                        {openSubsFor?.id === f.id && openSubsFor.anchor && (
                          <PortalDropdown
                            anchorEl={openSubsFor.anchor}
                            align="center"
                            minWidth={180}
                            closing={openSubsFor.closing}
                            durationMs={300}
                            onClose={() => setOpenSubsFor(null)}
                            className="admin-dropdown-panel py-2"
                          >
                            <div className="text-xs text-gray-300 px-3 mb-1">Available subtitles</div>
                            <div className="flex flex-col">
                              {subs.map((s) => (
                                <div key={s} className="admin-dropdown-item !py-2 !px-3" onClick={(e) => e.stopPropagation()}>
                                  <span className={`fi fi-${countryCodeForLang(s)} w-4 h-3`}></span>
                                  <span>{langLabel(s)}</span>
                                </div>
                              ))}
                            </div>
                          </PortalDropdown>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400">0 Subs</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="admin-btn secondary !px-2 !py-1"
                      title="Actions"
                      onClick={(e) => {
                        e.stopPropagation();
                        const el = e.currentTarget as HTMLElement;
                        setOpenMenuFor(prev => {
                          if (prev && prev.id === f.id) {
                            // trigger close with animation, then unmount after duration
                            const next = { ...prev, closing: true } as typeof prev;
                            setTimeout(() => setOpenMenuFor(null), 300);
                            return next;
                          }
                          return { id: f.id, anchor: el };
                        });
                        setOpenSubsFor(null);
                      }}
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                    {openMenuFor?.id === f.id && openMenuFor.anchor && (
                      <PortalDropdown
                        anchorEl={openMenuFor.anchor}
                        align="center"
                        closing={openMenuFor.closing}
                        durationMs={300}
                        onClose={() => setOpenMenuFor(null)}
                        className="admin-dropdown-panel py-1"
                      >
                        <div className="admin-dropdown-item" onClick={(e) => { e.stopPropagation(); setOpenMenuFor(null); navigate(`/admin/content/${encodeURIComponent(f.id)}`); }}>
                          <Eye className="w-4 h-4" />
                          <span>View</span>
                        </div>
                        <div className="admin-dropdown-item" onClick={(e) => { e.stopPropagation(); setOpenMenuFor(null); navigate(`/admin/update?slug=${encodeURIComponent(f.id)}`); }}>
                          <Pencil className="w-4 h-4" />
                          <span>Update</span>
                        </div>
                        <div className="admin-dropdown-item" onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuFor(null);
                          setConfirmDelete({ slug: f.id, title: f.title || f.id });
                        }}>
                          <Trash2 className="w-4 h-4" />
                          <span>Delete</span>
                        </div>
                      </PortalDropdown>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!loading && filteredRows.length > 0 && (
        <div className="mt-3">
          <Pagination
            mode="count"
            page={page}
            pageSize={pageSize}
            total={filteredRows.length}
            loading={loading}
            onPageChange={(p) => setPage(p)}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
            sizes={[10,20,50,100]}
          />
        </div>
      )}

      {/* Custom Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !deleting && setConfirmDelete(null)}>
          <div 
            className="bg-[#16111f] border-[3px] border-[#ec4899] rounded-xl p-6 max-w-md w-full mx-4 shadow-[0_0_0_2px_rgba(147,51,234,0.25)_inset,0_0_24px_rgba(236,72,153,0.35)]" 
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-[#f5d0fe] mb-4">Xác nhận xoá</h3>
            <p className="text-[#f5d0fe] mb-2">Bạn có chắc muốn xoá nội dung:</p>
            <p className="text-[#f9a8d4] font-semibold mb-4">"{confirmDelete.title}"</p>
            <p className="text-sm text-[#e9d5ff] mb-6">Thao tác này sẽ xoá toàn bộ Episodes, Cards và Media thuộc nội dung này. Không thể hoàn tác!</p>
            {deletionProgress && (
              <div className="mb-4 p-3 bg-[#241530] border-2 border-[#f472b6] rounded-lg">
                <div className="text-sm font-semibold text-[#f9a8d4] mb-2">{deletionProgress.stage}</div>
                <div className="text-xs text-[#e9d5ff] mb-2">{deletionProgress.details}</div>
                <ProgressBar percent={deletionPercent} />
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                className="admin-btn secondary"
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
              >
                Huỷ
              </button>
              <button
                className="admin-btn primary"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  setDeletionPercent(10);
                  let timer: number | undefined;
                  let slowTimer: number | undefined;
                  setDeletionProgress({ stage: 'Đang xoá...', details: 'Đang xử lý yêu cầu xoá (khởi tạo xoá database + thu thập media)' });
                  try {
                    // Phase 1: fast ramp to 70%
                    timer = window.setInterval(() => {
                      setDeletionPercent((p) => (p < 70 ? p + 4 : p));
                    }, 220);
                    setTimeout(() => {
                      // Phase 2: slower ramp 70% -> 85% (DB deletion likely still running or starting media deletion)
                      if (timer) window.clearInterval(timer);
                      timer = window.setInterval(() => {
                        setDeletionPercent((p) => (p < 85 ? p + 2 : p));
                      }, 500);
                    }, 3000);
                    // Phase 3: indeterminate finalization 85% -> 95% tiny heartbeat while media deletes concurrently
                    slowTimer = window.setInterval(() => {
                      setDeletionPercent((p) => (p >= 85 && p < 95 ? p + 1 : p));
                    }, 4000);
                    setDeletionProgress({ stage: 'Đang xoá database...', details: 'Xoá Episodes, Cards, subtitles và metadata' });
                    const res = await apiDeleteItem(confirmDelete.slug);
                    if ('error' in res) {
                      toast.error(res.error);
                      setDeletionProgress(null);
                      setDeletionPercent(0);
                      if (timer) window.clearInterval(timer);
                      if (slowTimer) window.clearInterval(slowTimer);
                      return;
                    }
                    if (timer) window.clearInterval(timer);
                    if (slowTimer) window.clearInterval(slowTimer);
                    setDeletionPercent(100);
                    setDeletionProgress({ stage: 'Hoàn tất', details: `Đã xoá ${res.episodes_deleted} episodes, ${res.cards_deleted} cards, ${res.media_deleted} media files` });
                    setRows(prev => prev.filter(r => r.id !== confirmDelete.slug));
                    // Refresh global main-language options; if current no longer available, switch to first
                    try {
                      const langs = await getAvailableMainLanguages();
                      const current = preferences.main_language || 'en';
                      if (!langs.includes(current) && langs.length) {
                        await setMainLanguage(langs[0]);
                      }
                    } catch {/* ignore refresh errors */}
                    setTimeout(() => {
                      const msg = `Đã xoá nội dung + media (Episodes: ${res.episodes_deleted}, Cards: ${res.cards_deleted}, Media: ${res.media_deleted}${res.media_errors.length ? ', Lỗi: ' + res.media_errors.length : ''})`;
                      toast.success(msg);
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
