 
import type { FilmDoc } from '../types';
import { CONTENT_TYPE_LABELS, type ContentType } from '../types/content';
import LanguageTag from './LanguageTag';
import { Film, Clapperboard, Book as BookIcon, AudioLines, X, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Props {
  film: FilmDoc | null;
  open: boolean;
  onClose: () => void;
}

export default function ContentDetailModal({ film, open, onClose }: Props) {
  const navigate = useNavigate();
  if (!film) return null;
  const rawType = film.type as string | undefined;
  const asContentType = (rawType && ['movie','series','book','audio'].includes(rawType)) ? (rawType as ContentType) : undefined;
  const typeLabel = (asContentType && CONTENT_TYPE_LABELS[asContentType]) || rawType || 'Content';
  const TypeIcon = film.type === 'movie' ? Film : film.type === 'series' ? Clapperboard : film.type === 'book' ? BookIcon : film.type === 'audio' ? AudioLines : null;
  
  // Use landscape cover if available, fallback to portrait cover
  const R2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, '') || '';
  
  // Landscape cover with proper URL construction (same logic as AdminContentDetailPage)
  let coverLandscape = film.cover_landscape_url || '';
  if (coverLandscape.startsWith('/') && R2Base) coverLandscape = R2Base + coverLandscape;
  if (!coverLandscape && film.id) {
    const path = `/items/${film.id}/cover_image/cover_landscape.jpg`;
    coverLandscape = R2Base ? R2Base + path : path;
  }
  
  // Portrait cover fallback
  let coverPortrait = film.cover_url || '';
  if (coverPortrait.startsWith('/') && R2Base) coverPortrait = R2Base + coverPortrait;
  if (!coverPortrait && film.id) {
    const path = `/items/${film.id}/cover_image/cover.jpg`;
    coverPortrait = R2Base ? R2Base + path : path;
  }
  
  const cover = coverLandscape || coverPortrait;
  
  return (
    <div 
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-500 ${
        open ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div 
        className={`relative w-[min(92vw,900px)] max-h-[88vh] overflow-y-auto bg-gradient-to-b from-[#181818] to-[#0f0f0f] rounded-xl shadow-[0_8px_60px_rgba(0,0,0,0.8)] transition-all duration-500 ${
          open ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        {/* Hero section with cover */}
        <div className="relative w-full aspect-video bg-black overflow-hidden">
          {cover && (
            <img 
              src={cover} 
              alt={String(film.title || film.id)} 
              className="w-full h-full object-contain"
              onContextMenu={(e) => e.preventDefault()}
              draggable={false}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-transparent to-transparent" />
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-[#181818]/90 hover:bg-white/10 border border-white/20 text-white flex items-center justify-center transition-colors backdrop-blur-sm"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
        
        {/* Content section */}
        <div className="p-6 md:p-8">
          <div className="max-w-3xl">
            {/* Action buttons */}
            <div className="flex items-center gap-3 mb-6">
              <button
                className="flex items-center gap-2 px-6 py-2.5 rounded-md bg-white hover:bg-white/90 text-black font-semibold text-base transition-colors"
                onClick={() => {
                  console.log('[ContentDetailModal] Play clicked for film:', { id: film.id, title: film.title });
                  onClose();
                  // film.id should be the slug according to FilmDoc type definition
                  navigate(`/watch/${encodeURIComponent(film.id)}`);
                }}
              >
                <Play size={20} fill="currentColor" />
                <span>Play</span>
              </button>
            </div>
            
            {/* Title and metadata */}
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 leading-tight whitespace-normal break-words overflow-visible">{film.title || film.id}</h2>
            
            <div className="flex items-center gap-3 mb-4 text-sm">
              <span className="px-2 py-0.5 border border-white/40 text-white text-xs">
                {film.release_year || 'N/A'}
              </span>
              <span className="px-2 py-0.5 border border-white/40 text-white text-xs">
                {typeof film.total_episodes === 'number' && film.total_episodes > 0 
                  ? `${film.total_episodes} Episode${film.total_episodes > 1 ? 's' : ''}`
                  : film.type === 'movie' 
                    ? '1 Episode'
                    : 'N/A'}
              </span>
              <span className="px-2 py-0.5 border border-white/40 text-white text-xs">HD</span>
            </div>
            
            {/* Description */}
            {film.description && (
              <p className="text-base text-gray-300 leading-relaxed mb-6">{film.description}</p>
            )}
          </div>
          
          {/* Details grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-gray-700/50">
            <div className="space-y-4">
              <div>
                <span className="text-gray-400 text-sm">Type: </span>
                <span className="text-white text-sm inline-flex items-center gap-1.5">
                  {TypeIcon && <TypeIcon className="w-4 h-4" />}
                  {typeLabel}
                </span>
              </div>
              {film.main_language && (
                <div>
                  <span className="text-gray-400 text-sm">Audio: </span>
                  <span className="text-white text-sm inline-flex items-center gap-1">
                    <LanguageTag code={film.main_language} size="sm" />
                  </span>
                </div>
              )}
              {typeof film.num_cards === 'number' && (
                <div>
                  <span className="text-gray-400 text-sm">Total Cards: </span>
                  <span className="text-white text-sm">{film.num_cards.toLocaleString()}</span>
                </div>
              )}
              {typeof film.avg_difficulty_score === 'number' && (
                <div>
                  <span className="text-gray-400 text-sm">Avg Difficulty: </span>
                  <span className="text-white text-sm">{film.avg_difficulty_score.toFixed(1)}/100</span>
                </div>
              )}
            </div>
            <div className="space-y-4">
              {(film.available_subs && film.available_subs.length > 0) && (
                <div>
                  <div className="text-gray-400 text-sm mb-2">Subtitles:</div>
                  <div className="flex flex-wrap gap-2">
                    {film.available_subs.slice(0, 15).map(l => (
                      <span key={l} className="inline-flex items-center gap-1 bg-gray-800/60 px-2 py-1 rounded text-xs text-gray-300 border border-gray-700/50">
                        <LanguageTag code={l} size="sm" />
                      </span>
                    ))}
                    {film.available_subs.length > 15 && (
                      <span className="inline-flex items-center text-white text-xs">+{film.available_subs.length - 15} more</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
