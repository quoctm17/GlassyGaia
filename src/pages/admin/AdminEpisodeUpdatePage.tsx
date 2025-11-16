import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiGetEpisodeDetail, apiUpdateEpisodeMeta } from '../../services/cfApi';
import type { EpisodeDetailDoc } from '../../types';
import toast from 'react-hot-toast';
import { uploadEpisodeCoverImage, uploadEpisodeFullMedia } from '../../services/storageUpload';
import { Loader2 } from 'lucide-react';

export default function AdminEpisodeUpdatePage() {
  const { contentSlug, episodeSlug } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ep, setEp] = useState<EpisodeDetailDoc | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  // File upload states
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);

  function parseEpisodeNumber(slug: string | undefined): number {
    if (!slug) return 1;
    let n = Number(String(slug).replace(/^e/i, ''));
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
        setTitle(row?.title || '');
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [contentSlug, episodeSlug]);

  const episodeNum = parseEpisodeNumber(episodeSlug);

  const handleSave = async () => {
    if (!contentSlug) return;
    setSaving(true);
    try {
      let coverUrl = ep?.cover_url;
      let audioUrl = ep?.full_audio_url;
      let videoUrl = ep?.full_video_url;

      // Upload cover if selected
      if (coverFile) {
        setUploadingCover(true);
        try {
          const key = await uploadEpisodeCoverImage({ filmId: contentSlug, episodeNum, file: coverFile });
          const r2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, "") || "";
          coverUrl = r2Base ? `${r2Base}/${key}` : `/${key}`;
          toast.success('Cover uploaded');
        } catch (e) {
          toast.error(`Cover upload failed: ${(e as Error).message}`);
        } finally {
          setUploadingCover(false);
        }
      }

      // Upload audio if selected
      if (audioFile) {
        setUploadingAudio(true);
        try {
          const key = await uploadEpisodeFullMedia({ filmId: contentSlug, episodeNum, type: 'audio', file: audioFile });
          const r2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, "") || "";
          audioUrl = r2Base ? `${r2Base}/${key}` : `/${key}`;
          toast.success('Audio uploaded');
        } catch (e) {
          toast.error(`Audio upload failed: ${(e as Error).message}`);
        } finally {
          setUploadingAudio(false);
        }
      }

      // Upload video if selected
      if (videoFile) {
        setUploadingVideo(true);
        try {
          const key = await uploadEpisodeFullMedia({ filmId: contentSlug, episodeNum, type: 'video', file: videoFile });
          const r2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, "") || "";
          videoUrl = r2Base ? `${r2Base}/${key}` : `/${key}`;
          toast.success('Video uploaded');
        } catch (e) {
          toast.error(`Video upload failed: ${(e as Error).message}`);
        } finally {
          setUploadingVideo(false);
        }
      }

      // Update episode metadata
      await apiUpdateEpisodeMeta({
        filmSlug: contentSlug,
        episodeNum,
        title: title || undefined,
        cover_url: coverUrl || undefined,
        full_audio_url: audioUrl || undefined,
        full_video_url: videoUrl || undefined,
      });
      toast.success('Episode updated successfully');
      // Refresh episode data to show updated values
      const refreshed = await apiGetEpisodeDetail({ filmSlug: contentSlug!, episodeNum });
      setEp(refreshed);
      setTitle(refreshed?.title || '');
      // Clear file inputs
      setCoverFile(null);
      setAudioFile(null);
      setVideoFile(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="text-lg">Admin: Update Episode</div>

      <div className="admin-section-header">
        <h2 className="admin-title">Update Episode: {episodeSlug}</h2>
        <button className="admin-btn secondary" onClick={() => navigate(`/admin/content/${encodeURIComponent(contentSlug || '')}/episodes/${episodeSlug}`)}>← Back</button>
      </div>

      {loading && <div className="admin-info">Loading…</div>}
      {error && <div className="admin-error">{error}</div>}
      {ep && (
        <div className="admin-panel space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <label className="w-40 text-sm">Episode</label>
              <input className="admin-input opacity-50 bg-gray-900/40 text-gray-400 cursor-not-allowed border border-gray-700 pointer-events-none" value={episodeSlug} disabled readOnly />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-40 text-sm">Title</label>
              <input className="admin-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Episode title" />
            </div>

            <div className="flex flex-col gap-2 md:col-span-2">
              <label className="w-40 text-sm">Cover Image</label>
              <div className="space-y-2">
                {ep.cover_url && (
                  <div className="text-xs text-gray-400">
                    Current: <a href={ep.cover_url} target="_blank" rel="noreferrer" className="text-pink-300 underline">View</a>
                  </div>
                )}
                <input 
                  type="file" 
                  accept="image/jpeg" 
                  onChange={(e) => setCoverFile(e.target.files?.[0] || null)} 
                  className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" 
                />
                <div className="text-[11px] text-gray-500">Path: items/{contentSlug}/episodes/{contentSlug}_{String(episodeNum).padStart(3,'0')}/cover/cover.jpg</div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="w-40 text-sm">Full Audio</label>
              <div className="space-y-2">
                {ep.full_audio_url && (
                  <div className="text-xs text-gray-400">
                    Current: <a href={ep.full_audio_url} target="_blank" rel="noreferrer" className="text-pink-300 underline">View</a>
                  </div>
                )}
                <input 
                  type="file" 
                  accept="audio/mpeg" 
                  onChange={(e) => setAudioFile(e.target.files?.[0] || null)} 
                  className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" 
                />
                <div className="text-[11px] text-gray-500">Path: items/{contentSlug}/episodes/{contentSlug}_{String(episodeNum).padStart(3,'0')}/full/audio.mp3</div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="w-40 text-sm">Full Video</label>
              <div className="space-y-2">
                {ep.full_video_url && (
                  <div className="text-xs text-gray-400">
                    Current: <a href={ep.full_video_url} target="_blank" rel="noreferrer" className="text-pink-300 underline">View</a>
                  </div>
                )}
                <input 
                  type="file" 
                  accept="video/mp4" 
                  onChange={(e) => setVideoFile(e.target.files?.[0] || null)} 
                  className="text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border file:border-pink-300 file:bg-pink-600 file:text-white hover:file:bg-pink-500 w-full" 
                />
                <div className="text-[11px] text-gray-500">Path: items/{contentSlug}/episodes/{contentSlug}_{String(episodeNum).padStart(3,'0')}/full/video.mp4</div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 justify-end">
            <button className="admin-btn secondary" onClick={() => navigate(`/admin/content/${encodeURIComponent(contentSlug || '')}/episodes/${episodeSlug}`)}>Cancel</button>
            <button
              className="admin-btn primary flex items-center gap-2"
              disabled={saving || uploadingCover || uploadingAudio || uploadingVideo}
              onClick={handleSave}
            >
              {(saving || uploadingCover || uploadingAudio || uploadingVideo) && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{saving ? 'Saving…' : 'Save'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
