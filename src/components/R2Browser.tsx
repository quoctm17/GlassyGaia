import { useEffect, useState } from "react";
import { Trash2, Folder, File as FileIcon, Loader2, Eye, MoreHorizontal } from "lucide-react";
import toast from "react-hot-toast";
import { apiR2List, apiR2Delete, apiR2ListFlatPage } from "../services/cfApi";
import PortalDropdown from "./PortalDropdown";
import ProgressBar from "./ProgressBar";


// R2 item type mirrors cfApi
interface R2Item {
  key: string;
  name: string;
  type: 'directory' | 'file';
  size?: string | number | null;
  modified?: string | null;
  url?: string;
}

export default function R2Browser() {
  const [prefix, setPrefix] = useState("");
  const [items, setItems] = useState<R2Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<null | { key: string; name: string; type: 'directory' | 'file' }>(null);
  const [deleting, setDeleting] = useState(false);
  const [openMenuFor, setOpenMenuFor] = useState<null | { key: string; anchor: HTMLElement; closing?: boolean }>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [recursiveDelete, setRecursiveDelete] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [progressTotal, setProgressTotal] = useState<number | null>(null);
  const [progressDone, setProgressDone] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiR2List(prefix)
      .then((rows) => setItems(rows as R2Item[]))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [prefix, refreshKey]);

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
      if (checked) next.add(key); else next.delete(key);
      return next;
    });
  };
  const toggleAll = (checked: boolean) => {
    if (!checked) { setSelected(new Set()); return; }
    const allFiles = items.filter(i => i.type === 'file').map(i => i.key);
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
                .then(() => { done++; setProgressDone(done); })
                .catch(() => { done++; setProgressDone(done); })
            );
          }
          await Promise.allSettled(batch);
        }
      }
      await runBatch();
      toast.success(`Deleted ${count} file(s)`);
      setSelected(new Set());
      setRefreshKey(k => k + 1);
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
            <button className="admin-btn secondary" onClick={onBack}>← Back</button>
          )}
          <h2 className="admin-title">R2 Object Storage</h2>
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-pink-200">Selected: {selected.size}</span>
            <button className="admin-btn danger" disabled={bulkDeleting} onClick={() => setConfirmBulk(true)}>
              {bulkDeleting ? 'Deleting…' : 'Delete Selected'}
            </button>
          </div>
        )}
      </div>
      <div className="admin-info">Browse and manage R2 objects and folders.</div>
      {/* Breadcrumbs / Directories Path */}
      <div className="flex items-center gap-2 text-sm text-pink-200 mt-1 mb-3">
        <span className="opacity-80">Path:</span>
        {(() => {
          const norm = prefix.replace(/\/$/, "");
          const parts = norm ? norm.split('/') : [];
          const crumbs = [
            { label: 'root', path: '' },
            ...parts.map((p, i) => ({
              label: p || '/',
              path: parts.slice(0, i + 1).join('/') + '/',
            })),
          ];
          return (
            <div className="flex flex-wrap items-center gap-1">
              {crumbs.map((c, i) => (
                <div key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="opacity-60">/</span>}
                  <button
                    className={`hover:underline ${i === crumbs.length - 1 ? 'text-pink-300' : 'text-pink-400'}`}
                    onClick={() => {
                      setPrefix(c.path);
                      setSelected(new Set());
                    }}
                  >{c.label || '/'}</button>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
      {loading && <div className="flex items-center gap-2 text-pink-400"><Loader2 className="animate-spin" /> Loading...</div>}
      {error && <div className="admin-error">{error}</div>}
      <div className="admin-table-wrapper" style={{ marginBottom: 12 }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th className="w-10">#</th>
              {items.some(i=>i.type==='file') && (
                <th className="w-10 text-center">
                  <input
                    type="checkbox"
                    aria-label="Select all files"
                    checked={items.filter(i=>i.type==='file').length>0 && items.filter(i=>i.type==='file').every(i=>selected.has(i.key))}
                    onChange={(e)=>toggleAll(e.currentTarget.checked)}
                    className="accent-pink-500"
                  />
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
            {items.map((item, idx) => (
              <tr key={item.key}>
                <td className="text-gray-400">{idx + 1}</td>
                {items.some(i=>i.type==='file') && (
                  <td className="text-center">
                    {item.type === 'file' ? (
                      <input
                        type="checkbox"
                        checked={selected.has(item.key)}
                        onChange={(e)=>toggleOne(item.key, e.currentTarget.checked)}
                        aria-label={`Select ${item.name}`}
                        className="accent-pink-500"
                      />
                    ) : null}
                  </td>
                )}
                <td>
                  {item.type === "directory" ? (
                    <button className="flex items-center gap-2 text-pink-600 hover:underline" onClick={() => onEnterFolder(item.key)}>
                      <Folder size={18} /> {item.name}
                    </button>
                  ) : (
                    <a href={item.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-pink-700 hover:underline">
                      <FileIcon size={16} /> {item.name}
                    </a>
                  )}
                </td>
                <td>{item.type}</td>
                <td>{item.size || "-"}</td>
                <td>{item.modified || "-"}</td>
                <td onMouseDown={(e)=>e.stopPropagation()}>
                  <button
                    className="admin-btn secondary !px-2 !py-1"
                    title="Actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      const el = e.currentTarget as HTMLElement;
                      setOpenMenuFor(prev => {
                        if (prev && prev.key === item.key) {
                          const next = { ...prev, closing: true } as typeof prev;
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
                          if (item.type === 'directory') onEnterFolder(item.key);
                          else if (item.url) window.open(item.url, '_blank', 'noopener');
                        }}
                      >
                        <Eye className="w-4 h-4" />
                        <span>View</span>
                      </div>
                      <div
                        className="admin-dropdown-item"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuFor(null);
                          // For folders, require user to explicitly enable recursive
                          setRecursiveDelete(false);
                          setConfirmDelete({ key: item.key, name: item.name, type: item.type });
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>{item.type === 'directory' ? 'Delete' : 'Delete'}</span>
                      </div>
                    </PortalDropdown>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && !loading && (
              <tr><td colSpan={items.some(i=>i.type==='file') ? 7 : 6} className="admin-empty">No objects found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Confirmation modal (same style as AdminContentListPage) */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !deleting && setConfirmDelete(null)}>
          <div 
            className="bg-[#16111f] border-[3px] border-[#ec4899] rounded-xl p-6 max-w-md w-full mx-4 shadow-[0_0_0_2px_rgba(147,51,234,0.25)_inset,0_0_24px_rgba(236,72,153,0.35)]" 
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-[#f5d0fe] mb-4">Xác nhận xoá</h3>
            <p className="text-[#f5d0fe] mb-2">Bạn có chắc muốn xoá {confirmDelete.type === 'directory' ? 'thư mục' : 'tập tin'}:</p>
            <div className="text-[#f9a8d4] font-semibold mb-4 break-words max-w-full max-h-24 overflow-auto">"{confirmDelete.name}"</div>
            {confirmDelete.type === 'directory' ? (
              <div className="mb-4 text-sm text-[#e9d5ff] space-y-2">
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={recursiveDelete} onChange={(e)=>setRecursiveDelete(e.currentTarget.checked)} className="accent-pink-500" />
                  <span>Xoá toàn bộ nội dung thư mục (recursive)</span>
                </label>
                <p>Thao tác này sẽ xoá tất cả file bên trong (không thể hoàn tác).</p>
                {!recursiveDelete && (
                  <p className="text-[#fda4af]">Bạn phải tick “recursive” để có thể xoá thư mục không rỗng.</p>
                )}
                {deleting && progressTotal && (
                  <div className="mt-3"><ProgressBar percent={Math.round((progressDone / progressTotal) * 100)} /></div>
                )}
              </div>
            ) : (
              <div className="mb-6">
                <p className="text-sm text-[#e9d5ff]">Thao tác này không thể hoàn tác!</p>
                {deleting && progressTotal && (
                  <div className="mt-3"><ProgressBar percent={Math.round((progressDone / progressTotal) * 100)} /></div>
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
                className={`admin-btn primary ${confirmDelete.type==='directory' && !recursiveDelete ? '!opacity-60 cursor-not-allowed' : ''}`}
                disabled={deleting || (confirmDelete.type==='directory' && !recursiveDelete)}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    if (confirmDelete.type === 'directory' && recursiveDelete) {
                      // Folder recursive: list all keys then delete with progress
                      setProgressDone(0);
                      setProgressTotal(null);
                      // Count phase
                      let cursor: string | null | undefined = undefined;
                      const keys: string[] = [];
                      while (true) {
                        const page = await apiR2ListFlatPage(confirmDelete.key, cursor || undefined);
                        for (const o of page.objects) keys.push(o.key);
                        if (!page.truncated) break;
                        cursor = page.cursor;
                      }
                      setProgressTotal(keys.length);
                      const concurrency = 20;
                      let idx = 0; let done = 0;
                      async function runBatch() {
                        while (idx < keys.length) {
                          const batch: Promise<unknown>[] = [];
                          for (let j = 0; j < concurrency && idx < keys.length; j++, idx++) {
                            const k = keys[idx];
                            batch.push(apiR2Delete(k).then(()=>{ done++; setProgressDone(done); }).catch(()=>{ done++; setProgressDone(done); }));
                          }
                          await Promise.allSettled(batch);
                        }
                      }
                      await runBatch();
                      setConfirmDelete(null);
                      setRefreshKey(k => k + 1);
                      toast.success('Deleted folder recursively');
                    } else {
                      // File delete or empty dir
                      const res = await apiR2Delete(confirmDelete.key, { recursive: false });
                      if ('error' in res) throw new Error(res.error);
                      setConfirmDelete(null);
                      setRefreshKey(k => k + 1);
                      toast.success('Deleted');
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
                {deleting ? 'Đang xoá...' : 'Xoá'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk delete confirm modal */}
      {confirmBulk && selected.size > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !bulkDeleting && setConfirmBulk(false)}>
          <div
            className="bg-[#16111f] border-[3px] border-[#ec4899] rounded-xl p-6 max-w-lg w-full mx-4 shadow-[0_0_0_2px_rgba(147,51,234,0.25)_inset,0_0_24px_rgba(236,72,153,0.35)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-[#f5d0fe] mb-4">Confirm Deletion</h3>
            <p className="text-[#e9d5ff] mb-2">Delete {selected.size} selected file(s)? This action cannot be undone.</p>
            <div className="bg-black/30 rounded-md p-3 max-h-40 overflow-auto text-sm text-pink-200">
              {Array.from(selected).slice(0, 20).map((k) => {
                const it = items.find(i => i.key === k);
                const name = it?.name || k.split('/').pop() || k;
                return <div key={k} className="truncate" title={k}>{name}</div>;
              })}
              {selected.size > 20 && (
                <div className="opacity-70 mt-1">…and {selected.size - 20} more</div>
              )}
            </div>
            {bulkDeleting && progressTotal && (
              <div className="mt-4"><ProgressBar percent={Math.round((progressDone / progressTotal) * 100)} /></div>
            )}
            <div className="flex gap-3 justify-end mt-6">
              <button className="admin-btn secondary" onClick={() => !bulkDeleting && setConfirmBulk(false)} disabled={bulkDeleting}>Cancel</button>
              <button className="admin-btn danger" disabled={bulkDeleting} onClick={async ()=>{ const keys = Array.from(selected); await onBulkDelete(keys); }}>
                {bulkDeleting ? 'Deleting…' : 'Delete Selected'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
