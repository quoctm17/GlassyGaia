import { useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { useUser } from '../../context/UserContext';
import { uploadCoverImage } from '../../services/storageUpload';
import { apiUpdateFilmMeta } from '../../services/cfApi';

export default function AdminFilmUpdatePage() {
  const { user, signInGoogle, adminKey, setAdminKey } = useUser();
  const allowedEmails = useMemo(
    () => (import.meta.env.VITE_IMPORT_ADMIN_EMAILS || '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean),
    []
  );
  const pass = (import.meta.env.VITE_IMPORT_KEY || '').toString();
  const requireKey = !!pass;
  const isAdmin = !!user && allowedEmails.includes(user.email || '') && (!requireKey || adminKey === pass);

  // Editable meta fields
  const [filmSlug, setFilmSlug] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [totalEpisodes, setTotalEpisodes] = useState<number | ''>('');

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'idle' | 'uploading-cover' | 'updating-meta' | 'done'>('idle');
  const [coverUploaded, setCoverUploaded] = useState(false);

  const r2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, '') || '';

  async function handleUploadCoverIfAny() {
    const input = document.getElementById('update-cover-file') as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return; // optional
    setStage('uploading-cover');
    await uploadCoverImage({ filmId: filmSlug, episodeNum: 1, file });
    const url = r2Base ? `${r2Base}/items/${filmSlug}/cover_image/cover.jpg` : `/items/${filmSlug}/cover_image/cover.jpg`;
    setCoverUrl(url);
    setCoverUploaded(true);
    toast.success('Cover uploaded');
  }

  async function onUpdateMeta() {
    if (!user) { toast.error('Sign in required'); return; }
    if (!isAdmin) { toast.error('Admin access required'); return; }
    if (!filmSlug) { toast.error('Film slug required'); return; }
    try {
      setBusy(true);
      setStage('idle');
      setCoverUploaded(false);
      await handleUploadCoverIfAny();
      setStage('updating-meta');
  await apiUpdateFilmMeta({ filmSlug, title: title || undefined, description: description || undefined, cover_url: coverUrl || undefined, total_episodes: typeof totalEpisodes === 'number' ? totalEpisodes : undefined });
      setStage('done');
      toast.success(`Updated meta for ${filmSlug}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <h1 className="text-xl font-semibold">Admin: Update Film Metadata</h1>

      {!user && (
        <div className="bg-gray-800 border border-gray-700 rounded p-4 space-y-3">
          <div className="text-sm">You must sign in to continue.</div>
          <button className="admin-btn" onClick={signInGoogle}>Sign in with Google</button>
        </div>
      )}

      {user && (
        <div className="bg-gray-800 border border-gray-700 rounded p-4 space-y-3 text-sm">
          <div>Signed in as <span className="text-gray-300">{user.email}</span></div>
          <div>Allowed admins: <span className="text-gray-400">{(import.meta.env.VITE_IMPORT_ADMIN_EMAILS || '').toString()}</span></div>
          {requireKey && (
            <div className="flex items-center gap-2">
              <label className="w-32">Admin Key</label>
              <input
                type="password"
                className="admin-input"
                value={adminKey}
                onChange={e => setAdminKey(e.target.value)}
                placeholder="Enter admin key"
              />
            </div>
          )}
          <div>Access: {isAdmin ? <span className="text-green-400">granted</span> : <span className="text-red-400">denied</span>}</div>
        </div>
      )}

      {isAdmin && (
        <div className="bg-gray-800 border border-gray-700 rounded p-4 space-y-4">
          <div className="text-sm font-semibold">Hướng dẫn</div>
          <div className="text-xs space-y-2 text-gray-300">
            <p>Chỉ sửa các trường metadata: <code>Title</code>, <code>Description</code>, <code>Cover</code>. Không đổi slug để tránh mất liên kết tới media/cards.</p>
            <p>Ảnh bìa mới sẽ được lưu ở: <code>items/{filmSlug || 'your_slug'}/cover_image/cover.jpg</code>.</p>
            <p>Nếu để trống Title/Description sẽ giữ nguyên giá trị cũ.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <label className="w-32 text-sm">Film Slug</label>
              <input
                className="admin-input"
                value={filmSlug}
                onChange={e => setFilmSlug(e.target.value)}
                placeholder="god_of_gamblers_2"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-32 text-sm">Total Episodes</label>
              <input
                type="number"
                min={1}
                className="admin-input"
                value={totalEpisodes}
                onChange={e => {
                  const n = Number(e.target.value);
                  setTotalEpisodes(!e.target.value ? '' : (Number.isFinite(n) ? Math.max(1, Math.floor(n)) : ''));
                }}
                placeholder="e.g. 12"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-32 text-sm">Title</label>
              <input
                className="admin-input"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="New title (optional)"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-32 text-sm">Cover (jpg)</label>
              <input id="update-cover-file" type="file" accept="image/jpeg" className="admin-input" />
            </div>
            <div className="flex items-start gap-2 md:col-span-2">
              <label className="w-32 text-sm pt-2">Description</label>
              <textarea
                className="admin-input"
                rows={3}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Film description (optional)"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              className="admin-btn primary"
              disabled={busy || !filmSlug || !isAdmin}
              onClick={onUpdateMeta}
              title={!isAdmin ? 'Admin access required' : undefined}
            >
              {busy ? 'Updating...' : 'Update Metadata'}
            </button>
            <div className="text-xs text-gray-400">Stage: {stage}</div>
          </div>
          {(stage === 'done') && coverUploaded && (
            <div className="text-xs text-green-400">Cover updated. URL: {coverUrl}</div>
          )}
        </div>
      )}
    </div>
  );
}
