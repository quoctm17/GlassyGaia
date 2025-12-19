import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  Trash2,
  Folder,
  File as FileIcon,
  Loader2,
  Eye,
  MoreHorizontal,
  Check,
  Search,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  apiR2Delete,
  apiR2ListFlatPage,
  apiR2ListPaged,
} from "../../services/cfApi";
import PortalDropdown from "../PortalDropdown";
import ProgressBar from "../ProgressBar";
import Pagination from "../Pagination";
import "../../styles/pages/admin/admin-content-media.css";

// R2 item type mirrors cfApi
interface R2Item {
  key: string;
  name: string;
  type: "directory" | "file";
  size?: string | number | null;
  modified?: string | null;
  url?: string;
}

export default function R2Browser({ initialPageSize = 50 }: { initialPageSize?: number }) {
  const [prefix, setPrefix] = useState("");
  const [items, setItems] = useState<R2Item[]>([]); // current page items
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [pages, setPages] = useState<R2Item[][]>([]); // cached pages
  const [pageIndex, setPageIndex] = useState(0); // 0-based
  const [nextCursor, setNextCursor] = useState<string | null>(null); // backend cursor for next page
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<null | {
    key: string;
    name: string;
    type: "directory" | "file";
  }>(null);
  const [deleting, setDeleting] = useState(false);
  const [openMenuFor, setOpenMenuFor] = useState<null | {
    key: string;
    anchor: HTMLElement;
    closing?: boolean;
  }>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [recursiveDelete, setRecursiveDelete] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [progressTotal, setProgressTotal] = useState<number | null>(null);
  const [progressDone, setProgressDone] = useState(0);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const prefetchAbortRef = useRef<{ prefix: string; pageSize: number; aborted: boolean } | null>(null);

  // Combine all cached pages plus current items for global search
  const allItems = useMemo(() => {
    const merged: Record<string, R2Item> = {};
    // include cached pages
    pages.forEach(page => {
      page.forEach(it => { merged[it.key] = it; });
    });
    // include current items (ensures first page before prefetch)
    items.forEach(it => { merged[it.key] = it; });
    return Object.values(merged);
  }, [pages, items]);

  const visibleItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return allItems.filter((it) => {
      const name = (it.name || '').toLowerCase();
      const key = (it.key || '').toLowerCase();
      return name.includes(q) || key.includes(q);
    });
  }, [items, allItems, searchQuery]);

  const startPrefetchAllRef = useRef<(cursor: string | null) => void>(()=>{});

  const startPrefetchAll = useCallback((initialCursor: string | null) => {
    if (!initialCursor) return;
    const token = { prefix, pageSize, aborted: false };
    prefetchAbortRef.current = token;
    let cursor: string | null = initialCursor;
    let localPagesCount = 1; // first page already loaded
    (async () => {
      try {
        while (cursor && !token.aborted) {
          const res = await apiR2ListPaged(prefix, cursor, pageSize);
          if (token.aborted || (res as unknown as { error?: string }).error) break;
          const list = Array.isArray(res.items) ? res.items : [];
          localPagesCount += 1;
          setPages(prev => [...prev, list as R2Item[]]);
          if (!res.truncated) {
            cursor = null;
            setTotalPages(localPagesCount);
            break;
          }
          cursor = res.cursor;
        }
        if (!cursor && !token.aborted) {
          setTotalPages(localPagesCount);
        }
      } catch {
        // ignore prefetch errors
      }
    })();
  }, [prefix, pageSize]);

  startPrefetchAllRef.current = startPrefetchAll;

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiR2ListPaged(prefix, undefined, pageSize);
      const list = Array.isArray(res.items) ? res.items : [];
      setItems(list as R2Item[]);
      setPages([list as R2Item[]]);
      setPageIndex(0);
      setNextCursor(res.truncated ? res.cursor : null);
      setTotalPages(res.truncated ? null : 1); // if not truncated, only 1 page
      if (res.truncated) {
        // start background prefetch to determine total pages
        startPrefetchAllRef.current?.(res.cursor);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [prefix, pageSize]);

  useEffect(() => {
    // reset when prefix / refresh / pageSize changes
    setPageIndex(0);
    setPages([]);
    setNextCursor(null);
    setTotalPages(null);
    // abort any ongoing prefetch
    if (prefetchAbortRef.current) prefetchAbortRef.current.aborted = true;
    loadFirstPage();
  }, [prefix, refreshKey, pageSize, loadFirstPage]);

  async function loadNextPage() {
    if (!nextCursor) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiR2ListPaged(prefix, nextCursor, pageSize);
      const list = Array.isArray(res.items) ? res.items : [];
      setPages(prev => [...prev, list as R2Item[]]);
      setPageIndex(prev => prev + 1);
      setItems(list as R2Item[]);
      setNextCursor(res.truncated ? res.cursor : null);
      if (!res.truncated) {
        setTotalPages(pages.length + 1); // all pages now known
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // jump & total removed per request (simplified)

  // unified next navigation: use cached page if exists else fetch
  function goNextPage() {
    if (pageIndex < pages.length - 1) {
      const newIndex = pageIndex + 1;
      setPageIndex(newIndex);
      setItems(pages[newIndex]);
      return;
    }
    if (nextCursor) {
      void loadNextPage();
    }
  }


  function goPrevPage() {
    if (pageIndex === 0) return;
    const newIndex = pageIndex - 1;
    setPageIndex(newIndex);
    setItems(pages[newIndex]);
    // nextCursor stays as previously fetched cursor (we don't rebuild older cursor chain for simplicity)
  }

  // per-item delete handled inside modal confirm button

  const onEnterFolder = (folder: string) => {
    setPrefix(folder);
    setSelected(new Set());
  };
  const onBack = () => {
    if (!prefix) return;
    const parts = prefix.replace(/\/$/, "").split("/");
    setPrefix(parts.slice(0, -1).join("/"));
    setSelected(new Set());
  };

  const toggleOne = (key: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };
  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelected(new Set());
      return;
    }
    const allFiles = visibleItems.filter((i) => i.type === "file").map((i) => i.key);
    setSelected(new Set(allFiles));
  };

  const onBulkDelete = async (keysOverride?: string[]) => {
    const keys = keysOverride ?? Array.from(selected);
    if (!keys.length) return;
    const count = keys.length;
    setProgressTotal(count);
    setProgressDone(0);
    setBulkDeleting(true);
    try {
      const concurrency = 6;
      let idx = 0;
      let done = 0;
      async function runBatch() {
        while (idx < keys.length) {
          const batch: Promise<unknown>[] = [];
          for (let j = 0; j < concurrency && idx < keys.length; j++, idx++) {
            const k = keys[idx];
            batch.push(
              apiR2Delete(k)
                .then(() => {
                  done++;
                  setProgressDone(done);
                })
                .catch(() => {
                  done++;
                  setProgressDone(done);
                })
            );
          }
          await Promise.allSettled(batch);
        }
      }
      await runBatch();
      toast.success(`Deleted ${count} file(s)`);
      setSelected(new Set());
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkDeleting(false);
      setProgressTotal(null);
      setProgressDone(0);
    }
  };

  return (
    <div className="admin-section admin-panel">
      <div className="admin-section-header flex items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          {prefix && (
            <button className="admin-btn secondary" onClick={onBack}>
              ← Back
            </button>
          )}
          <h2 className="admin-title" style={{ color: 'var(--primary)' }}>R2 Object Storage</h2>
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm" style={{ color: 'var(--text)' }}>
              Selected: {selected.size}
            </span>
            <button
              className="admin-btn danger"
              disabled={bulkDeleting}
              onClick={() => setConfirmBulk(true)}
            >
              {bulkDeleting ? "Deleting…" : "Delete Selected"}
            </button>
          </div>
        )}
      </div>
      <div className="admin-info">
        Browse and manage R2 objects and folders.
      </div>
      <div className="flex items-center gap-2 mt-2 mb-3">
        <div className="relative flex-1 max-w-xl">
          <input
            className="admin-input w-full !pl-10 !py-2"
            placeholder="Search folder or file name (global)"
            value={searchQuery}
            onChange={(e) => {
              const val = e.target.value;
              setSearchQuery(val);
              // If searching and we have more pages, prefetch all to enable global search
              if (val.trim() && nextCursor) {
                startPrefetchAllRef.current?.(nextCursor);
              }
            }}
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--sub-language-text)' }} />
          {searchQuery && (
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs typography-inter-4"
              style={{ color: 'var(--sub-language-text)' }}
              onClick={() => setSearchQuery("")}
            >
              Clear
            </button>
          )}
        </div>
        <button
          className="admin-btn secondary !px-3 !py-1 ml-auto"
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={loading}
        >
          Reload
        </button>
      </div>
      {/* Breadcrumbs / Directories Path */}
      <div className="flex items-center gap-2 text-sm mt-1 mb-3" style={{ color: 'var(--sub-language-text)' }}>
        <span className="opacity-80">Path:</span>
        {(() => {
          const norm = prefix.replace(/\/$/, "");
          const parts = norm ? norm.split("/") : [];
          const crumbs = [
            { label: "root", path: "" },
            ...parts.map((p, i) => ({
              label: p || "/",
              path: parts.slice(0, i + 1).join("/") + "/",
            })),
          ];
          return (
            <div className="flex flex-wrap items-center gap-1">
              {crumbs.map((c, i) => (
                <div key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="opacity-60">/</span>}
                  <button
                    className="hover:underline"
                    style={{ 
                      color: i === crumbs.length - 1 
                        ? 'var(--primary)' 
                        : 'var(--hover-select)' 
                    }}
                    onClick={() => {
                      setPrefix(c.path);
                      setSelected(new Set());
                    }}
                  >
                    {c.label || "/"}
                  </button>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
      {loading && (
        <div className="flex items-center gap-2" style={{ color: 'var(--primary)' }}>
          <Loader2 className="animate-spin" /> Loading...
        </div>
      )}
      {error && <div className="admin-error">{error}</div>}
      <div className="admin-table-wrapper" style={{ marginBottom: 12 }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th className="w-10">#</th>
              {(Array.isArray(visibleItems) && visibleItems.some((i) => i.type === "file")) && (
                <th className="w-12">
                  <button
                    type="button"
                    className="w-5 h-5 border-2 rounded flex items-center justify-center transition-colors"
                    style={{
                      backgroundColor: visibleItems.filter((i) => i.type === "file").length > 0 &&
                        visibleItems.filter((i) => i.type === "file").every((i) => selected.has(i.key))
                        ? 'var(--primary)'
                        : selected.size > 0
                        ? 'var(--primary)'
                        : 'transparent',
                      borderColor: selected.size > 0 ? 'var(--primary)' : 'var(--border)',
                      color: selected.size > 0 ? 'var(--text)' : 'transparent'
                    }}
                    onMouseEnter={(e) => {
                      if (selected.size === 0) {
                        e.currentTarget.style.borderColor = 'var(--primary)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selected.size === 0) {
                        e.currentTarget.style.borderColor = 'var(--border)';
                      }
                    }}
                    onClick={() => {
                      const allFiles = visibleItems.filter((i) => i.type === "file");
                      const allSelected = allFiles.length > 0 && allFiles.every((i) => selected.has(i.key));
                      toggleAll(!allSelected);
                    }}
                    title={selected.size > 0 ? 'Deselect all' : 'Select all'}
                  >
                    {selected.size > 0 && <Check className="w-3 h-3" style={{ color: 'var(--text)' }} />}
                  </button>
                </th>
              )}
              <th>Name</th>
              <th>Type</th>
              <th>Size</th>
              <th>Modified</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item, idx) => {
              const isSelected = selected.has(item.key);
              return (
              <tr 
                key={item.key} 
                style={isSelected && item.type === 'file' ? { backgroundColor: 'var(--hover-bg-subtle)' } : {}}
              >
                <td style={{ color: 'var(--sub-language-text)' }}>{idx + 1}</td>
                {(Array.isArray(visibleItems) && visibleItems.some((i) => i.type === "file")) && (
                  <td>
                    {item.type === "file" ? (
                      <button
                        type="button"
                        className="w-5 h-5 border-2 rounded flex items-center justify-center transition-colors"
                        style={{
                          backgroundColor: isSelected ? 'var(--primary)' : 'transparent',
                          borderColor: isSelected ? 'var(--primary)' : 'var(--border)',
                          color: isSelected ? 'var(--text)' : 'transparent'
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected) {
                            e.currentTarget.style.borderColor = 'var(--primary)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected) {
                            e.currentTarget.style.borderColor = 'var(--border)';
                          }
                        }}
                        onClick={() => toggleOne(item.key, !isSelected)}
                      >
                        {isSelected && <Check className="w-3 h-3" style={{ color: 'var(--text)' }} />}
                      </button>
                    ) : null}
                  </td>
                )}
                <td>
                  {item.type === "directory" ? (
                    <button
                      className="flex items-center gap-2 hover:underline"
                      style={{ color: 'var(--hover-select)' }}
                      onClick={() => onEnterFolder(item.key)}
                    >
                      <Folder size={18} /> {item.name}
                    </button>
                  ) : (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 hover:underline"
                      style={{ color: 'var(--primary)' }}
                    >
                      <FileIcon size={16} /> {item.name}
                    </a>
                  )}
                </td>
                <td>{item.type}</td>
                <td>{item.size || "-"}</td>
                <td>{item.modified || "-"}</td>
                <td onMouseDown={(e) => e.stopPropagation()}>
                  <button
                    className="admin-btn secondary !px-2 !py-1"
                    title="Actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      const el = e.currentTarget as HTMLElement;
                      setOpenMenuFor((prev) => {
                        if (prev && prev.key === item.key) {
                          const next = {
                            ...prev,
                            closing: true,
                          } as typeof prev;
                          setTimeout(() => setOpenMenuFor(null), 300);
                          return next;
                        }
                        return { key: item.key, anchor: el };
                      });
                    }}
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                  {openMenuFor?.key === item.key && openMenuFor.anchor && (
                    <PortalDropdown
                      anchorEl={openMenuFor.anchor}
                      align="center"
                      closing={openMenuFor.closing}
                      durationMs={300}
                      onClose={() => setOpenMenuFor(null)}
                      className="admin-dropdown-panel py-1"
                    >
                      <div
                        className="admin-dropdown-item"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuFor(null);
                          if (item.type === "directory")
                            onEnterFolder(item.key);
                          else if (item.url)
                            window.open(item.url, "_blank", "noopener");
                        }}
                      >
                        <Eye className="w-4 h-4" />
                        <span>View</span>
                      </div>
                      <div
                        className="admin-dropdown-item danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuFor(null);
                          // For folders, require user to explicitly enable recursive
                          setRecursiveDelete(false);
                          setConfirmDelete({
                            key: item.key,
                            name: item.name,
                            type: item.type,
                          });
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>
                          {item.type === "directory" ? "Delete" : "Delete"}
                        </span>
                      </div>
                    </PortalDropdown>
                  )}
                </td>
              </tr>
            );
            })}
            {Array.isArray(visibleItems) && visibleItems.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={(Array.isArray(visibleItems) && visibleItems.some((i) => i.type === "file")) ? 7 : 6}
                  className="admin-empty"
                >
                  No objects found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination (hidden when searching globally) */}
      {!searchQuery && (
        <div className="mt-3">
          <Pagination
            mode="cursor"
            pageIndex={pageIndex}
            pageSize={pageSize}
            hasPrev={pageIndex > 0}
            hasNext={(pageIndex < pages.length - 1) || !!nextCursor}
            loading={loading}
            onPrev={goPrevPage}
            onNext={goNextPage}
            onPageSizeChange={(n) => setPageSize(n)}
            totalPages={totalPages}
          />
        </div>
      )}

      {/* Confirmation modal (same style as AdminContentListPage) */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => !deleting && setConfirmDelete(null)}
        >
          <div
            className="admin-modal-panel max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold admin-modal-title mb-4">
              Xác nhận xoá
            </h3>
            <p className="admin-modal-text mb-2">
              Bạn có chắc muốn xoá{" "}
              {confirmDelete.type === "directory" ? "thư mục" : "tập tin"}:
            </p>
            <div className="admin-accent-strong font-semibold mb-4 break-words max-w-full max-h-24 overflow-auto">
              "{confirmDelete.name}"
            </div>
            {confirmDelete.type === "directory" ? (
              <div className="mb-4 text-sm admin-modal-text space-y-2">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={recursiveDelete}
                    onChange={(e) =>
                      setRecursiveDelete(e.currentTarget.checked)
                    }
                    className="accent-pink-500"
                  />
                  <span>Xoá toàn bộ nội dung thư mục (recursive)</span>
                </label>
                <p>
                  Thao tác này sẽ xoá tất cả file bên trong (không thể hoàn
                  tác).
                </p>
                {!recursiveDelete && (
                  <p className="admin-warning-text">
                    Bạn phải tick “recursive” để có thể xoá thư mục không rỗng.
                  </p>
                )}
                {deleting && progressTotal && (
                  <div className="mt-3">
                    <ProgressBar
                      percent={Math.round((progressDone / progressTotal) * 100)}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="mb-6">
                <p className="text-sm admin-modal-text">
                  Thao tác này không thể hoàn tác!
                </p>
                {deleting && progressTotal && (
                  <div className="mt-3">
                    <ProgressBar
                      percent={Math.round((progressDone / progressTotal) * 100)}
                    />
                  </div>
                )}
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
                className={`admin-btn primary ${
                  confirmDelete.type === "directory" && !recursiveDelete
                    ? "!opacity-60 cursor-not-allowed"
                    : ""
                }`}
                disabled={
                  deleting ||
                  (confirmDelete.type === "directory" && !recursiveDelete)
                }
                onClick={async () => {
                  setDeleting(true);
                  try {
                    if (confirmDelete.type === "directory" && recursiveDelete) {
                      // Folder recursive: list all keys then delete with progress
                      setProgressDone(0);
                      setProgressTotal(null);
                      // Count phase
                      let cursor: string | null | undefined = undefined;
                      const keys: string[] = [];
                      while (true) {
                        const page = await apiR2ListFlatPage(
                          confirmDelete.key,
                          cursor || undefined
                        );
                        for (const o of page.objects) keys.push(o.key);
                        if (!page.truncated) break;
                        cursor = page.cursor;
                      }
                      setProgressTotal(keys.length);
                      const concurrency = 20;
                      let idx = 0;
                      let done = 0;
                      async function runBatch() {
                        while (idx < keys.length) {
                          const batch: Promise<unknown>[] = [];
                          for (
                            let j = 0;
                            j < concurrency && idx < keys.length;
                            j++, idx++
                          ) {
                            const k = keys[idx];
                            batch.push(
                              apiR2Delete(k)
                                .then(() => {
                                  done++;
                                  setProgressDone(done);
                                })
                                .catch(() => {
                                  done++;
                                  setProgressDone(done);
                                })
                            );
                          }
                          await Promise.allSettled(batch);
                        }
                      }
                      await runBatch();
                      setConfirmDelete(null);
                      setRefreshKey((k) => k + 1);
                      toast.success("Deleted folder recursively");
                    } else {
                      // File delete or empty dir
                      const res = await apiR2Delete(confirmDelete.key, {
                        recursive: false,
                      });
                      if ("error" in res) throw new Error(res.error);
                      setConfirmDelete(null);
                      setRefreshKey((k) => k + 1);
                      toast.success("Deleted");
                    }
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : String(e));
                  } finally {
                    setDeleting(false);
                    setProgressTotal(null);
                    setProgressDone(0);
                  }
                }}
              >
                {deleting ? "Đang xoá..." : "Xoá"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk delete confirm modal */}
      {confirmBulk && selected.size > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => !bulkDeleting && setConfirmBulk(false)}
        >
          <div
            className="admin-modal-panel max-w-lg w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold admin-modal-title mb-4">
              Confirm Deletion
            </h3>
            <p className="admin-modal-text mb-2">
              Delete {selected.size} selected file(s)? This action cannot be
              undone.
            </p>
            <div className="admin-subpanel rounded-md p-3 max-h-40 overflow-auto text-sm admin-modal-text">
              {Array.from(selected)
                .slice(0, 20)
                .map((k) => {
                  const it = items.find((i) => i.key === k);
                  const name = it?.name || k.split("/").pop() || k;
                  return (
                    <div key={k} className="truncate" title={k}>
                      {name}
                    </div>
                  );
                })}
              {selected.size > 20 && (
                <div className="opacity-70 mt-1">
                  …and {selected.size - 20} more
                </div>
              )}
            </div>
            {bulkDeleting && progressTotal && (
              <div className="mt-4">
                <ProgressBar
                  percent={Math.round((progressDone / progressTotal) * 100)}
                />
              </div>
            )}
            <div className="flex gap-3 justify-end mt-6">
              <button
                className="admin-btn secondary"
                onClick={() => !bulkDeleting && setConfirmBulk(false)}
                disabled={bulkDeleting}
              >
                Cancel
              </button>
              <button
                className="admin-btn danger"
                disabled={bulkDeleting}
                onClick={async () => {
                  const keys = Array.from(selected);
                  await onBulkDelete(keys);
                }}
              >
                {bulkDeleting ? "Deleting…" : "Delete Selected"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
