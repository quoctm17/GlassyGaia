import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiGetEpisodeDetail } from "../../services/cfApi";
import type { EpisodeDetailDoc, LevelFrameworkStats } from "../../types";
import { ExternalLink } from "lucide-react";

export default function AdminEpisodeDetailPage() {
  const { contentSlug, episodeSlug } = useParams();
  const navigate = useNavigate();
  const [ep, setEp] = useState<EpisodeDetailDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <h2 className="admin-title">Episode Details: {episodeSlug}</h2>
        <button className="admin-btn secondary" onClick={() => navigate(`/admin/content/${encodeURIComponent(contentSlug || '')}`)}>← Back</button>
      </div>

      {loading && <div className="admin-info">Loading episode...</div>}
      {error && <div className="admin-error">{error}</div>}
      {ep && (
        <div className="admin-panel mb-4 space-y-2">
          <div><span className="font-semibold">Episode #:</span> {ep.episode_number}</div>
          <div><span className="font-semibold">Title:</span> {ep.title || '-'}</div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold">Cover:</span>
              {ep.cover_url ? (
                <a href={ep.cover_url} target="_blank" rel="noreferrer" className="admin-btn secondary inline-flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <ExternalLink className="w-4 h-4" />
                  Open
                </a>
              ) : <span>-</span>}
            </div>
            {ep.cover_url && (
              <img src={ep.cover_url} alt="cover" className="w-32 h-auto rounded border-2 border-pink-500 hover:border-pink-400 transition-colors shadow-[0_0_10px_rgba(236,72,153,0.4)]" />
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="font-semibold">Full Audio:</span>
              {ep.full_audio_url ? <a href={ep.full_audio_url} target="_blank" rel="noreferrer" className="admin-btn secondary" onClick={e => e.stopPropagation()}>Open</a> : <span>-</span>}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">Full Video:</span>
              {ep.full_video_url ? <a href={ep.full_video_url} target="_blank" rel="noreferrer" className="admin-btn secondary" onClick={e => e.stopPropagation()}>Open</a> : <span>-</span>}
            </div>
          </div>
          <div><span className="font-semibold">Total Cards:</span> {ep.num_cards ?? '-'}</div>
          <div><span className="font-semibold">Avg Difficulty:</span> {typeof ep.avg_difficulty_score === 'number' ? ep.avg_difficulty_score.toFixed(1) : '-'}</div>
          <div>
            <span className="font-semibold">Level Distribution:</span>
            {levelStats && levelStats.length ? (
              <div className="mt-2 space-y-2">
                {levelStats.map((entry, idx) => (
                  <div key={idx} className="bg-gray-800/40 rounded p-2">
                    <div className="text-sm text-pink-300">{entry.framework}{entry.language ? ` · ${entry.language}` : ''}</div>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {Object.entries(entry.levels).map(([lvl, pct]) => (
                        <div key={lvl} className="text-xs bg-gray-700/60 px-2 py-0.5 rounded">
                          <span className="text-gray-300">{lvl}:</span> <span className="text-pink-300">{pct}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <span> -</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
