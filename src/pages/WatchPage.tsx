import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { VariableSizeList as List } from 'react-window';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Globe } from 'lucide-react';
import type { FilmDoc, EpisodeDetailDoc, CardDoc, GetProgressResponse } from '../types';
import { 
  apiGetFilm, 
  apiListEpisodes, 
  apiFetchCardsForFilm,
  apiGetEpisodeComments,
  apiCreateEpisodeComment,
  apiVoteEpisodeComment,
  apiGetEpisodeCommentVotes,
  apiGetCardSaveStatusBatch,
  apiUpdateCardSRSState,
  apiListItems,
  type EpisodeComment
} from '../services/cfApi';
import { SELECTABLE_SRS_STATES, SRS_STATE_LABELS, type SRSState } from '../types/srsStates';
import { getEpisodeProgress, markCardComplete, markCardIncomplete } from '../services/userProgress';
import { useUser } from '../context/UserContext';
import LearningProgressBar from '../components/LearningProgressBar';
import SubtitleLanguageSelector from '../components/SubtitleLanguageSelector';
import { canonicalizeLangCode } from '../utils/lang';
import { getLevelBadgeColors } from '../utils/levelColors';
import { normalizeCjkSpacing } from '../utils/subtitles';
import {
  escapeHtml,
  highlightHtml,
  highlightInsideHtmlPreserveTags,
  bracketToRubyHtml,
  codeToName,
  parseLevelStats,
} from '../utils/watchPageHelpers';
import rightAngleIcon from '../assets/icons/right-angle.svg';
import filterIcon from '../assets/icons/filter.svg';
import customIcon from '../assets/icons/custom.svg';
import buttonPlayIcon from '../assets/icons/button-play.svg';
import buttonPauseIcon from '../assets/icons/button-pause.svg';
import enterMovieViewIcon from '../assets/icons/enter-movie-view.svg';
import commentIcon from '../assets/icons/comment.svg';
import commentPostIcon from '../assets/icons/comment-post.svg';
import recommendationIcon from '../assets/icons/recommendation.svg';
import upvoteIcon from '../assets/icons/upvote.svg';
import downvoteIcon from '../assets/icons/downvote.svg';
import searchIcon from '../assets/icons/search.svg';
import starIcon from '../assets/icons/star.svg';
import starFillIcon from '../assets/icons/star-fill.svg';
import saveHeartIcon from '../assets/icons/save-heart.svg';
import threeDotsIcon from '../assets/icons/three-dots.svg';
import linkIcon from '../assets/icons/link.svg';
import flagIcon from '../assets/icons/flag.svg';
import eyeIcon from '../assets/icons/eye.svg';
import warningIcon from '../assets/icons/icon-warning.svg';
import headphoneIcon from '../assets/icons/headphone.svg';
import buttonAutoplayPrimaryIcon from '../assets/icons/button-autoplay-primary.svg';
import '../styles/pages/watch-page.css';
import '../styles/components/search-result-card.css';

/** Drop cards marked unavailable (defense in depth; Worker usually returns is_available=1 only). */
function onlyAvailableCards(list: CardDoc[]): CardDoc[] {
  return list.filter((c) => c.is_available !== false);
}

export default function WatchPage() {
  const { contentId } = useParams<{ contentId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetEpisodeSlug = searchParams.get('episode');
  const targetCardId = searchParams.get('card');
  const { preferences, user } = useUser();
  const [film, setFilm] = useState<FilmDoc | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeDetailDoc[]>([]);
  const [currentEpisode, setCurrentEpisode] = useState<EpisodeDetailDoc | null>(null);
  const [cards, setCards] = useState<CardDoc[]>([]);
  const [currentCardIndex, setCurrentCardIndex] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [loadingMoreCards, setLoadingMoreCards] = useState(false);
  const [noMoreCards, setNoMoreCards] = useState(false);
  const [progress, setProgress] = useState<GetProgressResponse | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const [tagsDropdownOpen, setTagsDropdownOpen] = useState(true);
  const tagsDropdownRef = useRef<HTMLDivElement | null>(null);
  const episodesPanelRef = useRef<HTMLDivElement | null>(null);
  const [comments, setComments] = useState<EpisodeComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentVotes, setCommentVotes] = useState<Record<string, number>>({});
  const [newCommentText, setNewCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [cardSaveStates, setCardSaveStates] = useState<Record<string, { saved: boolean; srsState: SRSState }>>({});
  const [srsDropdownOpen, setSrsDropdownOpen] = useState(false);
  const srsDropdownRef = useRef<HTMLDivElement | null>(null);
  const [recommendations, setRecommendations] = useState<FilmDoc[]>([]);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);
  const [isStarred, setIsStarred] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Virtualization refs (react-window VariableSizeList)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subtitlesListRef = useRef<any>(null);
  const cardHeightsRef = useRef<Record<string, number>>({});
  const ESTIMATED_HEIGHT = 72;

  const R2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, '') || '';

  // Memoized card id → index map to avoid O(n²) findIndex in render
  const cardIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    cards.forEach((c, i) => map.set(c.id, i));
    return map;
  }, [cards]);

  // Auto-scroll carousel and subtitle list when card changes
  useEffect(() => {
    const scroll = () => {
      // Scroll carousel thumbnail to center
      if (carouselRef.current) {
        const thumbnail = carouselRef.current.querySelector(`[data-card-index="${currentCardIndex}"]`);
        if (thumbnail) {
          thumbnail.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
      }

      // Scroll subtitle card to center within the visible area of the container
      const cardElement = document.getElementById(`card-${currentCardIndex}`);
      if (cardElement) {
        const container = cardElement.closest('.watch-list') as HTMLElement;
        if (container) {
          const containerHeight = container.clientHeight;
          const cardOffsetTop = cardElement.offsetTop;
          const cardHeight = cardElement.offsetHeight;
          const scrollPosition = cardOffsetTop - (containerHeight / 2) + (cardHeight / 2);
          container.scrollTo({ top: scrollPosition, behavior: 'smooth' });
        }
      }
    };
    const rafId = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(rafId);
  }, [currentCardIndex]);

  // Progressive loading: Load more cards when approaching the end
  useEffect(() => {
    if (!contentId || !currentEpisode || loadingMoreCards || noMoreCards) return;
    
    // Trigger when within 10 cards of the end
    const shouldLoadMore = currentCardIndex >= cards.length - 10 && cards.length > 0;
    
    if (shouldLoadMore) {
      const loadMoreCards = async () => {
        try {
          setLoadingMoreCards(true);
          
          // Get the start time of the last card to continue from there
          const lastCard = cards[cards.length - 1];
          const startFrom = Math.floor(lastCard.end); // Start from the end of last card
          
          // Fetch next batch
          const moreCards = await apiFetchCardsForFilm(contentId, currentEpisode.slug, 100, { startFrom });
          
          if (moreCards && moreCards.length > 0) {
            // Merge and deduplicate
            const key = (c: CardDoc) => `${c.id}|${Math.floor(c.start)}`;
            const seen = new Set(cards.map(key));
            const merged = [...cards];
            
            for (const card of onlyAvailableCards(moreCards)) {
              const k = key(card);
              if (!seen.has(k)) {
                merged.push(card);
                seen.add(k);
              }
            }
            
            // Sort by start time
            merged.sort((a, b) => (a.start - b.start) || (a.end - b.end));
            setCards(onlyAvailableCards(merged));
          } else {
            // No more cards available
            setNoMoreCards(true);
          }
        } catch (error) {
          console.error('Failed to load more cards:', error);
        } finally {
          setLoadingMoreCards(false);
        }
      };
      
      loadMoreCards();
    }
  }, [currentCardIndex, cards, contentId, currentEpisode, loadingMoreCards, noMoreCards]);

  useEffect(() => {
    if (!contentId) return;
    
    const loadData = async () => {
      try {
        setLoading(true);
        // Load film metadata
        const filmData = await apiGetFilm(contentId);
        setFilm(filmData);
        
        // Load episodes
        const episodesData = await apiListEpisodes(contentId);
        setEpisodes(episodesData);
        
        // Set episode: use target from query params, or default to first
        if (episodesData.length > 0) {
          const targetEp = targetEpisodeSlug
            ? episodesData.find(ep => ep.slug === targetEpisodeSlug)
            : null;
          setCurrentEpisode(targetEp || episodesData[0]);
        }
      } catch (error) {
        console.error('Failed to load content:', error);
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
  }, [contentId]);

  // Load card save states when cards change
  // Skip loading when searching to avoid resource conflicts
  useEffect(() => {
    if (!user?.uid || cards.length === 0 || !contentId || !currentEpisode) {
      setCardSaveStates({});
      return;
    }

    // Skip loading save states when searching to improve performance
    // Will load after search is cleared
    // NOTE: searchQuery is intentionally NOT in deps — it would cause the effect
    // to fire on every keystroke. The guard below still uses its current value.
    if (searchQuery.trim()) {
      return;
    }

    let cancelled = false;

    const loadCardSaveStates = async () => {
      const states: Record<string, { saved: boolean; srsState: SRSState }> = {};
      const filmFallback = contentId || '';
      const episodeFallback =
        currentEpisode?.slug ||
        '';

      const batchPayload = cards
        .map((card) => {
          const filmId = card.film_id || filmFallback;
          const episodeId =
            card.episode_id ||
            (typeof card.episode === 'number' ? `e${card.episode}` : String(card.episode || '')) ||
            episodeFallback;
          return { card, filmId, episodeId };
        })
        .filter((x) => x.filmId && x.episodeId)
        .map(({ card, filmId, episodeId }) => ({
          card_id: String(card.id),
          film_id: filmId,
          episode_id: episodeId,
        }));

      // Worker /api/card/save-status-batch: one JOIN + one IN query per chunk (max 100).
      // Sequential chunks avoid D1 overload from dozens of parallel GET /save-status calls.
      const CHUNK = 80;
      for (let i = 0; i < batchPayload.length; i += CHUNK) {
        if (cancelled) return;
        const slice = batchPayload.slice(i, i + CHUNK);
        const batchResult = await apiGetCardSaveStatusBatch(user.uid, slice);
        for (const [cardId, status] of Object.entries(batchResult)) {
          states[cardId] = {
            saved: status.saved,
            srsState: status.srs_state as SRSState,
          };
        }
        if (i + CHUNK < batchPayload.length) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      for (const card of cards) {
        if (!states[card.id]) {
          states[card.id] = { saved: false, srsState: 'none' };
        }
      }

      if (!cancelled) {
        setCardSaveStates(states);
      }
    };

    loadCardSaveStates();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, cards, contentId, currentEpisode]); // searchQuery intentionally omitted

  // Close SRS dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (srsDropdownRef.current && !srsDropdownRef.current.contains(event.target as Node)) {
        setSrsDropdownOpen(false);
      }
    };
    if (srsDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [srsDropdownOpen]);

  // Get dominant level for a film based on level_framework_stats (same logic as ContentTypeGrid)
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

  // Load recommendations based on current content
  useEffect(() => {
    if (!film) {
      setRecommendations([]);
      return;
    }

    const loadRecommendations = async () => {
      try {
        setLoadingRecommendations(true);
        
        // Get dominant level from film (not episode)
        const dominantLevel = getDominantLevel(film);
        if (!dominantLevel) {
          setRecommendations([]);
          return;
        }

        // Get framework from film's level_framework_stats
        const stats = parseLevelStats(film.level_framework_stats);
        if (!stats || !Array.isArray(stats) || stats.length === 0) {
          setRecommendations([]);
          return;
        }

        // Find the framework that contains the dominant level
        let targetFramework: string | null = null;
        for (const entry of stats) {
          if (!entry.levels || typeof entry.levels !== 'object') continue;
          const levels = Object.keys(entry.levels);
          if (levels.some(level => level.toUpperCase() === dominantLevel)) {
            targetFramework = entry.framework;
            break;
          }
        }

        if (!targetFramework) {
          setRecommendations([]);
          return;
        }

        // Use apiListItems to get all items, then filter
        const allItems = await apiListItems();
        
        // Filter by type, main_language, and level framework
        const filtered = allItems
          .filter((item) => {
            // Same type
            if (item.type !== film.type) return false;
            
            // Same main language
            if (item.main_language !== film.main_language) return false;
            
            // Has matching level framework and dominant level
            const itemStats = parseLevelStats(item.level_framework_stats);
            if (!itemStats || !Array.isArray(itemStats) || itemStats.length === 0) return false;
            
            // Check if item has the same framework and dominant level
            for (const entry of itemStats) {
              if (entry.framework !== targetFramework) continue;
              if (!entry.levels || typeof entry.levels !== 'object') continue;
              
              const itemLevels = Object.keys(entry.levels);
              // Check if item has the dominant level (or similar level in same framework)
              if (itemLevels.some(level => level.toUpperCase() === dominantLevel)) {
                return true;
              }
            }
            
            return false;
          })
          .filter((item) => item.id !== film.id) // Exclude current content
          .slice(0, 2); // Limit to 2
        
        setRecommendations(filtered);
      } catch (error) {
        console.error('Failed to load recommendations:', error);
        setRecommendations([]);
      } finally {
        setLoadingRecommendations(false);
      }
    };

    loadRecommendations();
  }, [film?.id, film?.type, film?.main_language, film?.level_framework_stats]);

  // Load cards when episode changes
  useEffect(() => {
    if (!contentId || !currentEpisode) return;
    
    const loadCards = async () => {
      try {
        // Use limit 100 to avoid SQLite parameter limit (200 cards × 34 languages > 999 params)
        const cardsData = await apiFetchCardsForFilm(contentId, currentEpisode.slug, 100);
        // Ensure cards are in ascending start-time order to align with media playback
        const sorted = onlyAvailableCards([...cardsData]).sort((a, b) => {
          const as = Number(a.start || 0);
          const bs = Number(b.start || 0);
          if (as !== bs) return as - bs;
          // tie-breaker: end time
          const ae = Number(a.end || 0);
          const be = Number(b.end || 0);
          return ae - be;
        });
        setCards(sorted);
        setCurrentCardIndex(0);
        setNoMoreCards(false);

        // If navigated from "View Card", scroll to the target card
        if (targetCardId) {
          const targetIdx = sorted.findIndex(c => String(c.id) === targetCardId);
          if (targetIdx >= 0) {
            setCurrentCardIndex(targetIdx);
          }
        }

        // Always load user progress when logged in (regardless of targetCardId)
        // so LearningProgressBar always renders when user is authenticated
        if (user?.uid) {
          setLoadingProgress(true);
          try {
            const progressData = await getEpisodeProgress(user.uid, contentId, currentEpisode.slug);
            setProgress(progressData);

            // Resume from last card only if NOT navigating to a specific card
            if (!targetCardId && progressData.episode_stats && progressData.episode_stats.last_card_index > 0) {
              setCurrentCardIndex(progressData.episode_stats.last_card_index);
            }
          } catch (error) {
            console.error('Failed to load progress:', error);
            setProgress(null);
          } finally {
            setLoadingProgress(false);
          }
        }
        
        // Background loading: Load remaining cards in batches
        // Only if episode has more cards than initial batch
        if (currentEpisode.num_cards && currentEpisode.num_cards > sorted.length) {
          const loadRemainingCards = async () => {
            try {
              const allCards = [...sorted];
              let hasMore = true;
              
              while (hasMore && allCards.length < currentEpisode.num_cards!) {
                const lastCard = allCards[allCards.length - 1];
                const startFrom = Math.floor(lastCard.end);
                
                // Load in batches of 100
                const batchCards = await apiFetchCardsForFilm(contentId, currentEpisode.slug, 100, { startFrom });
                
                if (batchCards && batchCards.length > 0) {
                  const key = (c: CardDoc) => `${c.id}|${Math.floor(c.start)}`;
                  const seen = new Set(allCards.map(key));
                  
                  for (const card of onlyAvailableCards(batchCards)) {
                    const k = key(card);
                    if (!seen.has(k)) {
                      allCards.push(card);
                      seen.add(k);
                    }
                  }
                  
                  allCards.sort((a, b) => (a.start - b.start) || (a.end - b.end));
                  
                  // Update cards state periodically (every 100 cards)
                  setCards(onlyAvailableCards([...allCards]));
                  
                  // Small delay to avoid overwhelming the API
                  await new Promise(resolve => setTimeout(resolve, 500));
                } else {
                  hasMore = false;
                  setNoMoreCards(true);
                }
              }
              
              console.log(`Background loading complete: ${allCards.length} cards loaded`);
            } catch (error) {
              console.error('Background card loading failed:', error);
            }
          };
          
          // Start background loading after a short delay
          setTimeout(() => {
            loadRemainingCards();
          }, 2000);
        }
      } catch (error) {
        console.error('Failed to load cards:', error);
        setCards([]);
      }
    };
    
    loadCards();
  }, [contentId, currentEpisode, user, targetCardId]);

  // Toggle card completion status
  const handleToggleComplete = useCallback(async (markAsComplete: boolean) => {
    if (!user?.uid || !contentId || !currentEpisode || !cards[currentCardIndex]) return;

    // Optimistically update UI first
    if (progress) {
      const newCompletedIndices = new Set(progress.completed_indices);
      if (markAsComplete) {
        newCompletedIndices.add(currentCardIndex);
      } else {
        newCompletedIndices.delete(currentCardIndex);
      }
      setProgress({
        ...progress,
        completed_indices: newCompletedIndices,
      });
    }

    try {
      if (markAsComplete) {
        // Mark as completed in backend
        await markCardComplete({
          user_id: user.uid,
          film_id: contentId,
          episode_slug: currentEpisode.slug,
          card_id: cards[currentCardIndex].id,
          card_index: currentCardIndex,
          total_cards: currentEpisode.num_cards || cards.length,
        });
      } else {
        // Mark as incomplete in backend (delete progress record)
        await markCardIncomplete({
          user_id: user.uid,
          film_id: contentId,
          episode_slug: currentEpisode.slug,
          card_id: cards[currentCardIndex].id,
          total_cards: currentEpisode.num_cards || cards.length,
        });
      }
    } catch (error) {
      console.error('Failed to toggle card completion:', error);

      // Revert optimistic update on error by reloading from backend
      if (user?.uid && contentId && currentEpisode) {
        try {
          const updatedProgress = await getEpisodeProgress(user.uid, contentId, currentEpisode.slug);
          setProgress(updatedProgress);
        } catch (reloadError) {
          console.error('Failed to reload progress:', reloadError);
        }
      }
    }
  }, [user, contentId, currentEpisode, currentCardIndex, cards, progress]);


  const handleEpisodeClick = (episode: EpisodeDetailDoc) => {
    setCurrentEpisode(episode);
    setCurrentCardIndex(0);
  };

  // Load comments when episode changes
  useEffect(() => {
    if (!currentEpisode?.slug || !contentId || !user?.uid) {
      setComments([]);
      setCommentVotes({});
      return;
    }

    const loadComments = async () => {
      try {
        setLoadingComments(true);
        const episodeComments = await apiGetEpisodeComments(currentEpisode.slug, contentId);
        setComments(episodeComments);

        // Load user's votes for these comments
        if (episodeComments.length > 0) {
          const commentIds = episodeComments.map(c => c.id);
          const votes = await apiGetEpisodeCommentVotes(user.uid, commentIds);
          setCommentVotes(votes);
        }
      } catch (error) {
        console.error('Failed to load comments:', error);
      } finally {
        setLoadingComments(false);
      }
    };

    loadComments();
  }, [currentEpisode?.slug, contentId, user?.uid]);

  const handleSubmitComment = useCallback(async () => {
    if (!user?.uid || !currentEpisode?.slug || !contentId || !newCommentText.trim()) {
      return;
    }

    try {
      setSubmittingComment(true);
      const newComment = await apiCreateEpisodeComment({
        userId: user.uid,
        episodeSlug: currentEpisode.slug,
        filmSlug: contentId,
        text: newCommentText.trim(),
      });
      
      setComments(prev => [newComment, ...prev]);
      setNewCommentText('');
    } catch (error) {
      console.error('Failed to create comment:', error);
    } finally {
      setSubmittingComment(false);
    }
  }, [user?.uid, currentEpisode?.slug, contentId, newCommentText]);

  const handleVoteComment = async (commentId: string, voteType: 1 | -1) => {
    if (!user?.uid) return;

    const currentVote = commentVotes[commentId];

    // If clicking the same vote type, remove the vote; otherwise change to the new type
    const newVoteType = currentVote === voteType ? null : voteType;

    // Optimistic update: update votes map and comment scores locally
    setCommentVotes((prev) => {
      const next = { ...prev };
      if (newVoteType === null) {
        delete next[commentId];
      } else {
        next[commentId] = newVoteType;
      }
      return next;
    });

    setComments((prev) =>
      prev.map((c) => {
        if (c.id !== commentId) return c;
        const prevVote = currentVote ?? 0;
        const newVote = newVoteType ?? 0;
        return {
          ...c,
          upvotes: c.upvotes + (newVote === 1 ? 1 : prevVote === 1 ? -1 : 0),
          downvotes: c.downvotes + (newVote === -1 ? 1 : prevVote === -1 ? -1 : 0),
        };
      })
    );

    try {
      if (newVoteType === null) {
        await apiVoteEpisodeComment({ userId: user.uid, commentId, voteType });
      } else {
        await apiVoteEpisodeComment({ userId: user.uid, commentId, voteType: newVoteType });
      }
      // On success: sort comments by score descending (only re-sort, don't reload all)
      setComments((prev) =>
        [...prev].sort((a, b) => (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes))
      );
    } catch (error) {
      console.error('Failed to vote on comment:', error);
      // Revert: reload both from server
      if (currentEpisode?.slug && contentId) {
        try {
          const [episodeComments, votes] = await Promise.all([
            apiGetEpisodeComments(currentEpisode.slug, contentId),
            apiGetEpisodeCommentVotes(user.uid, comments.map((c) => c.id)),
          ]);
          setComments(episodeComments);
          setCommentVotes(votes);
        } catch {
          /* ignore revert failure */
        }
      }
    }
  };

  // Handle SRS state change (same logic as SearchResultCard)
  const handleSRSStateChange = async (card: CardDoc, newState: SRSState) => {
    if (!user?.uid || !card.id) return;
    
    try {
      // Ensure we have film_id and episode_id - use currentEpisode and contentId if card doesn't have them
      const filmId = card.film_id || contentId || '';
      const episodeId = card.episode_id || (typeof card.episode === 'number' ? `e${card.episode}` : String(card.episode || '')) || (currentEpisode?.slug || '');
      
      if (!filmId || !episodeId) {
        console.error('Missing film_id or episode_id for SRS update:', { filmId, episodeId, card });
        return;
      }
      
      await apiUpdateCardSRSState(
        user.uid, 
        card.id, 
        newState,
        filmId,
        episodeId
      );
      
      setCardSaveStates(prev => ({
        ...prev,
        [card.id]: {
          ...prev[card.id],
          srsState: newState,
        },
      }));
      
      setSrsDropdownOpen(false);
    } catch (error) {
      console.error('Failed to update SRS state:', error);
    }
  };

  const handleCardClick = useCallback((index: number) => {
    // If target card is not loaded yet, load it first
    if (index >= cards.length) {
      // Load cards up to the target index
      const loadToTarget = async () => {
        try {
          setLoadingMoreCards(true);
          const lastCard = cards[cards.length - 1];
          const startFrom = Math.floor(lastCard.end);

          // Calculate how many cards we need to load
          const cardsToLoad = Math.min(index - cards.length + 50, 200); // Load target + 50 more, max 200

          const moreCards = await apiFetchCardsForFilm(contentId!, currentEpisode!.slug, cardsToLoad, { startFrom });

          if (moreCards && moreCards.length > 0) {
            const key = (c: CardDoc) => `${c.id}|${Math.floor(c.start)}`;
            const seen = new Set(cards.map(key));
            const merged = [...cards];

            for (const card of onlyAvailableCards(moreCards)) {
              const k = key(card);
              if (!seen.has(k)) {
                merged.push(card);
                seen.add(k);
              }
            }

            merged.sort((a, b) => (a.start - b.start) || (a.end - b.end));
            setCards(onlyAvailableCards(merged));

            // Now jump to the target card
            setTimeout(() => {
              if (index < merged.length) {
                setCurrentCardIndex(index);
              } else {
                console.warn('Target card not available after loading');
              }
            }, 100);
          }
        } catch (error) {
          console.error('Failed to load cards for jump:', error);
        } finally {
          setLoadingMoreCards(false);
        }
      };

      loadToTarget();
    } else {
      // Card already loaded, just jump to it
      setCurrentCardIndex(index);
    }
  }, [cards, contentId, currentEpisode]);

  const handleNextCard = useCallback(() => {
    // Use filtered cards when searching
    const cardsToUse = searchQuery.trim() ? filteredCards : cards;
    const currentIndexInCardsToUse = searchQuery.trim() ? (
      (() => {
        const originalCard = cards[currentCardIndex];
        const filteredIdx = originalCard ? filteredCards.findIndex(c => c.id === originalCard.id) : -1;
        return filteredIdx >= 0 ? filteredIdx : 0;
      })()
    ) : currentCardIndex;
    
    if (currentIndexInCardsToUse < cardsToUse.length - 1) {
      // Move to next card in filtered/all cards
      const nextCard = cardsToUse[currentIndexInCardsToUse + 1];
      const nextOriginalIndex = cardIndexMap.get(nextCard.id) ?? -1;
      if (nextOriginalIndex >= 0) {
        handleCardClick(nextOriginalIndex);
      }
    } else if (currentIndexInCardsToUse === cardsToUse.length - 1 && !loadingMoreCards && !noMoreCards) {
      // At the last filtered card, if not searching, try to load more cards
      if (!searchQuery.trim() && currentCardIndex === cards.length - 1) {
      const tryLoadMore = async () => {
        if (!contentId || !currentEpisode) return;
        
        try {
          setLoadingMoreCards(true);
          const lastCard = cards[cards.length - 1];
          const startFrom = Math.floor(lastCard.end);
          
          const moreCards = await apiFetchCardsForFilm(contentId, currentEpisode.slug, 100, { startFrom });
          
          if (moreCards && moreCards.length > 0) {
            const key = (c: CardDoc) => `${c.id}|${Math.floor(c.start)}`;
            const seen = new Set(cards.map(key));
            const merged = [...cards];
            
            for (const card of onlyAvailableCards(moreCards)) {
              const k = key(card);
              if (!seen.has(k)) {
                merged.push(card);
                seen.add(k);
              }
            }
            
            merged.sort((a, b) => (a.start - b.start) || (a.end - b.end));
            setCards(onlyAvailableCards(merged));
            
            // Move to next card after loading
            setTimeout(() => {
              handleCardClick(currentCardIndex + 1);
            }, 100);
          } else {
            setNoMoreCards(true);
          }
        } catch (error) {
          console.error('Failed to load more cards:', error);
        } finally {
          setLoadingMoreCards(false);
        }
      };
      
      tryLoadMore();
      }
    }
  }, [cards, currentCardIndex, loadingMoreCards, noMoreCards, contentId, currentEpisode, handleCardClick]);

  const getCoverUrl = (episode: EpisodeDetailDoc | null) => {
    if (!episode || !contentId) return '';
    let cover = episode.cover_url || '';
    if (cover.startsWith('/') && R2Base) cover = R2Base + cover;
    if (!cover) {
      const path = `/items/${contentId}/episodes/e${episode.episode_number}/cover_landscape.jpg`;
      cover = R2Base ? R2Base + path : path;
    }
    return cover;
  };

  // Build subtitle HTML for a card (must be before cardSubtitleHtmlCache)
  const buildSubtitleHtml = (card: CardDoc, langCode: string, highlightQuery?: string): { html: string; isRuby: boolean } => {
    const raw = getSubtitleText(card, langCode);
    if (!raw) {
      return { html: '', isRuby: false };
    }
    const canon = (canonicalizeLangCode(langCode) || langCode).toLowerCase();
    const needsRuby = canon === 'ja' || canon === 'zh' || canon === 'zh_trad' || canon === 'yue';
    if (!needsRuby) {
      const html = highlightQuery ? highlightHtml(raw, highlightQuery) : escapeHtml(raw);
      return { html, isRuby: false };
    }
    const normalized = normalizeCjkSpacing(raw);
    const rubyHtml = bracketToRubyHtml(normalized, canon);
    const html = highlightQuery ? highlightInsideHtmlPreserveTags(rubyHtml, highlightQuery, canon) : rubyHtml;
    return { html, isRuby: true };
  };

  // Get subtitle text for a card
  const getSubtitleText = (card: CardDoc, lang: string): string => {
    return card.subtitle?.[lang] || '';
  };

  // Get main language subtitle (from film main_language)
  const mainLanguage = film?.main_language || 'en';
  
  // Subtitle languages selected from user preferences (for secondary subtitles)
  const subtitleLanguages = preferences?.subtitle_languages || [];

  // Precompute subtitle text map for search filtering (avoids per-card per-lang lookups)
  const subtitleTextCache = useMemo(() => {
    const cache = new Map<string, Record<string, string>>();
    const langs = [mainLanguage, ...subtitleLanguages];
    cards.forEach((card) => {
      const texts: Record<string, string> = {};
      langs.forEach((lang) => {
        texts[lang] = getSubtitleText(card, lang) || '';
      });
      cache.set(card.id, texts);
    });
    return cache;
  }, [cards, mainLanguage, subtitleLanguages]);

  // Selected subtitle languages (memoized to avoid recompute per card)
  const selectedSubtitleLangs = useMemo(() =>
    subtitleLanguages.filter((lang) => lang && lang !== mainLanguage),
    [subtitleLanguages, mainLanguage]
  );

  const selectedSubtitleLangsKey = useMemo(
    () => selectedSubtitleLangs.join('\0'),
    [selectedSubtitleLangs]
  );

  useEffect(() => {
    cardHeightsRef.current = {};
    subtitlesListRef.current?.resetAfterIndex(0);
  }, [contentId, currentEpisode?.slug, searchQuery, selectedSubtitleLangsKey]);

  // Filter cards based on search query
  const filteredCards = useMemo(() => {
    if (!searchQuery.trim()) {
      return cards;
    }

    const query = searchQuery.toLowerCase();
    return cards.filter((card) => {
      const texts = subtitleTextCache.get(card.id);
      if (!texts) return false;
      const subtitleTextsForSearch = [texts[mainLanguage] || '', ...selectedSubtitleLangs.map((l) => texts[l] || '')];
      return subtitleTextsForSearch.some((text) => text.toLowerCase().includes(query));
    });
  }, [cards, searchQuery, subtitleTextCache, mainLanguage, selectedSubtitleLangs]);

  // Precompute all subtitle HTML for all cards — avoids calling buildSubtitleHtml
  // inside the JSX map on every render (was the #1 performance bottleneck)
  const cardsToRender = searchQuery.trim() ? filteredCards : cards;
  const cardSubtitleHtmlCache = useMemo(() => {
    const cache = new Map<string, { mainHtml: string; mainIsRuby: boolean; subHtml: Record<string, string> }>();
    const canon = canonicalizeLangCode(mainLanguage) || mainLanguage;
    const langsToRender = selectedSubtitleLangs;

    cardsToRender.forEach((card) => {
      // Main language subtitle
      const { html: mainHtml, isRuby: mainIsRuby } = buildSubtitleHtml(card, canon, searchQuery.trim() || undefined);

      // Secondary language subtitles
      const subHtml: Record<string, string> = {};
      langsToRender.forEach((lang) => {
        const { html } = buildSubtitleHtml(card, lang, searchQuery.trim() || undefined);
        subHtml[lang] = html;
      });

      cache.set(card.id, { mainHtml, mainIsRuby, subHtml });
    });

    return cache;
  }, [cardsToRender, mainLanguage, selectedSubtitleLangs, searchQuery]);

  const getItemSize = (index: number): number => {
    const card = cardsToRender[index];
    if (!card) return ESTIMATED_HEIGHT;
    const stored = cardHeightsRef.current[card.id];
    if (stored != null && stored > 0) return stored;
    const subLines = selectedSubtitleLangs.filter(Boolean).length;
    const rowGap = 8;
    const approxLine = 34;
    return 20 + (1 + subLines) * approxLine + subLines * rowGap;
  };

  // Scroll virtualized list to current card when it changes
  useEffect(() => {
    const list = subtitlesListRef.current;
    if (!list) return;
    const targetIdx = searchQuery.trim() ? (
      (() => {
        const originalCard = cards[currentCardIndex];
        const filteredIdx = originalCard ? filteredCards.findIndex(c => c.id === originalCard.id) : -1;
        return filteredIdx >= 0 ? filteredIdx : 0;
      })()
    ) : currentCardIndex;
    if (targetIdx < 0 || targetIdx >= cardsToRender.length) return;
    list.scrollToItem(targetIdx, { align: 'center', behavior: 'smooth' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCardIndex, cards, filteredCards]);

  // Get current card from filtered cards (for display and auto-play)
  // Always use original card from cards array to preserve full data (including levels)
  const currentCard = useMemo(() => {
    if (!searchQuery.trim()) {
      return cards[currentCardIndex] || null;
    }
    // Find current card in filtered cards, but return original card from cards array
    const originalCard = cards[currentCardIndex];
    if (!originalCard) return null;
    const filteredIdx = filteredCards.findIndex(c => c.id === originalCard.id);
    if (filteredIdx >= 0 && filteredIdx < filteredCards.length) {
      // Return original card to preserve all data (levels, etc.)
      return originalCard;
    }
    // If current card not in filtered list, find first filtered card's original
    if (filteredCards.length > 0) {
      const firstFilteredCard = filteredCards[0];
      const firstOriginalIndex = cardIndexMap.get(firstFilteredCard.id) ?? -1;
      return firstOriginalIndex >= 0 ? cards[firstOriginalIndex] : null;
    }
    return null;
  }, [cards, currentCardIndex, filteredCards, searchQuery, cardIndexMap]);

  // Get current filtered card index
  const currentFilteredCardIndex = useMemo(() => {
    if (!searchQuery.trim()) {
      return currentCardIndex;
    }
    const originalCard = cards[currentCardIndex];
    if (!originalCard) return 0;
    const filteredIdx = filteredCards.findIndex(c => c.id === originalCard.id);
    return filteredIdx >= 0 ? filteredIdx : 0;
  }, [cards, currentCardIndex, filteredCards, searchQuery]);

  // Row renderer + height getter for react-window VariableSizeList
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const SubtitleRow = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
    const card = cardsToRender[index];
    if (!card) return null;
    const originalIndex = cardIndexMap.get(card.id) ?? -1;
    const isActive = searchQuery.trim()
      ? index === currentFilteredCardIndex
      : index === currentCardIndex;
    const isCompleted = originalIndex >= 0 && progress?.completed_indices.has(originalIndex) || false;
    const cached = cardSubtitleHtmlCache.get(card.id);
    const primaryCode = canonicalizeLangCode(mainLanguage) || mainLanguage;
    const mainName = codeToName(primaryCode);

    return (
      <div className="watch-card-slot" style={{ ...style, overflow: 'visible' }}>
        <div
          id={`card-${originalIndex >= 0 ? originalIndex : index}`}
          ref={(el) => {
            if (!el) return;
            const applyHeight = () => {
              const h = Math.ceil(el.offsetHeight);
              if (h > 0 && cardHeightsRef.current[card.id] !== h) {
                cardHeightsRef.current[card.id] = h;
                subtitlesListRef.current?.resetAfterIndex(index);
              }
            };
            applyHeight();
            requestAnimationFrame(applyHeight);
          }}
          onClick={() => handleCardClick(originalIndex >= 0 ? originalIndex : index)}
          className={`watch-card ${isActive ? 'watch-card--active' : ''} ${isCompleted ? 'watch-card--completed' : ''}`}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleCardClick(originalIndex >= 0 ? originalIndex : index);
            }
          }}
        >
          <div className="watch-card-subtitles">
            <div
              className={`${mainName}-main ${cached?.mainIsRuby ? 'hanzi-ruby' : ''} subtitle-row expanded`}
              style={{ color: 'var(--text)' }}
            >
              <span
                className="subtitle-text"
                dangerouslySetInnerHTML={{ __html: cached?.mainHtml || '' }}
              />
            </div>
            {selectedSubtitleLangs.map((lang) => {
              const subHtml = cached?.subHtml[lang];
              if (!subHtml) return null;
              const subName = codeToName(lang);
              const canonSub = (canonicalizeLangCode(lang) || lang).toLowerCase();
              const subNeedsRuby =
                canonSub === 'ja' || canonSub === 'zh' || canonSub === 'zh_trad' || canonSub === 'yue';
              return (
                <div
                  key={lang}
                  className={`${subName}-sub ${subNeedsRuby ? 'hanzi-ruby' : ''} subtitle-row expanded`}
                >
                  <span className="subtitle-text" dangerouslySetInnerHTML={{ __html: subHtml }} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }, [cardsToRender, cardIndexMap, currentFilteredCardIndex, currentCardIndex, progress, cardSubtitleHtmlCache, mainLanguage, selectedSubtitleLangs, searchQuery, handleCardClick]);


  // Get current card's media URLs (using currentCard from filtered cards)
  const getCurrentCardImageUrl = () => {
    if (!currentCard) return '';
    let imageUrl = currentCard.image_url || '';
    if (imageUrl.startsWith('/') && R2Base) imageUrl = R2Base + imageUrl;
    return imageUrl;
  };

  const getCurrentCardAudioUrl = () => {
    if (!currentCard) return '';
    let audioUrl = currentCard.audio_url || '';
    if (audioUrl.startsWith('/') && R2Base) audioUrl = R2Base + audioUrl;
    return audioUrl;
  };

  // Play audio of current card (must be before handleAutoPlayToggle)
  const playCurrentCardAudio = useCallback(() => {
    const audioUrl = getCurrentCardAudioUrl();
    if (!audioUrl) {
      setIsAutoPlaying(false);
      return;
    }

    if (audioRef.current) {
      audioRef.current.src = audioUrl;
      audioRef.current.volume = (preferences.volume || 80) / 100;
      audioRef.current.play().catch((error) => {
        console.error('Failed to play audio:', error);
        setIsAutoPlaying(false);
      });
    }
  }, [currentCard, preferences.volume, getCurrentCardAudioUrl]);

  // Toggle auto-play
  const handleAutoPlayToggle = useCallback(() => {
    if (isAutoPlaying) {
      // Stop auto-play - just pause, don't reset
      setIsAutoPlaying(false);
      if (audioRef.current) {
        audioRef.current.pause();
      }
    } else {
      // Start auto-play
      setIsAutoPlaying(true);
      playCurrentCardAudio();
    }
  }, [isAutoPlaying, playCurrentCardAudio]);

  // Handle auto-play audio end - auto advance to next filtered card
  const handleAutoPlayAudioEnd = async () => {
    if (!isAutoPlaying) return;
    
    // Use filtered cards when searching
    const cardsToUse = searchQuery.trim() ? filteredCards : cards;
    const currentIndexInCardsToUse = searchQuery.trim() ? (
      (() => {
        const originalCard = cards[currentCardIndex];
        const filteredIdx = originalCard ? filteredCards.findIndex(c => c.id === originalCard.id) : -1;
        return filteredIdx >= 0 ? filteredIdx : 0;
      })()
    ) : currentCardIndex;
    
    // Mark current card as completed (skip if searching to speed up auto-play)
    if (!searchQuery.trim() && user?.uid && contentId && currentEpisode && currentCard) {
      try {
        await markCardComplete({
          user_id: user.uid,
          film_id: contentId,
          episode_slug: currentEpisode.slug,
          card_id: currentCard.id,
          card_index: currentCardIndex,
          total_cards: currentEpisode.num_cards || cards.length,
        });
        
        // Update local progress state
        if (progress) {
          const newCompletedIndices = new Set(progress.completed_indices);
          newCompletedIndices.add(currentCardIndex);
          setProgress({
            ...progress,
            completed_indices: newCompletedIndices,
          });
        }
      } catch (error) {
        console.error('Failed to mark card as completed:', error);
      }
    }
    
    // Move to next card in filtered/all cards
    if (currentIndexInCardsToUse < cardsToUse.length - 1) {
      // Move to next filtered card
      const nextCard = cardsToUse[currentIndexInCardsToUse + 1];
      const nextOriginalIndex = cardIndexMap.get(nextCard.id) ?? -1;
      if (nextOriginalIndex >= 0) {
        setCurrentCardIndex(nextOriginalIndex);
      } else {
        setIsAutoPlaying(false);
      }
    } else {
      // No more filtered cards, or at end of all cards
      if (!searchQuery.trim() && currentCardIndex < cards.length - 1) {
        // Not searching and not at end - should not happen, but handle gracefully
        const nextIndex = currentCardIndex + 1;
        setCurrentCardIndex(nextIndex);
      } else if (!searchQuery.trim() && currentCardIndex >= cards.length - 1 && !loadingMoreCards && !noMoreCards) {
        // At the last card and not searching, try to load more
    const totalCardsCount = typeof currentEpisode?.num_cards === 'number' && currentEpisode.num_cards > 0
      ? currentEpisode.num_cards
      : cards.length;
    
        if (currentCardIndex < totalCardsCount - 1) {
      try {
        setLoadingMoreCards(true);
        const lastCard = cards[cards.length - 1];
        const startFrom = Math.floor(lastCard.end);
        
        const moreCards = await apiFetchCardsForFilm(contentId!, currentEpisode!.slug, 100, { startFrom });
        
        if (moreCards && moreCards.length > 0) {
          const key = (c: CardDoc) => `${c.id}|${Math.floor(c.start)}`;
          const seen = new Set(cards.map(key));
          const merged = [...cards];
          
          for (const card of onlyAvailableCards(moreCards)) {
            const k = key(card);
            if (!seen.has(k)) {
              merged.push(card);
              seen.add(k);
            }
          }
          
          merged.sort((a, b) => (a.start - b.start) || (a.end - b.end));
          setCards(onlyAvailableCards(merged));
          
          // Move to next card after loading (useEffect will handle playing)
          const nextIndex = currentCardIndex + 1;
          setCurrentCardIndex(nextIndex);
        } else {
          setNoMoreCards(true);
          setIsAutoPlaying(false);
        }
      } catch (error) {
        console.error('Failed to load more cards:', error);
        setIsAutoPlaying(false);
      } finally {
        setLoadingMoreCards(false);
      }
    } else {
      // No more cards, stop auto-play
      setIsAutoPlaying(false);
        }
      } else {
        // No more filtered cards or at end, stop auto-play
        setIsAutoPlaying(false);
      }
    }
  };

  // Auto-play when card changes and auto-play is enabled (use currentCard from filtered cards)
  useEffect(() => {
    if (isAutoPlaying && currentCard && audioRef.current) {
      const audioUrl = getCurrentCardAudioUrl();
      if (audioUrl) {
        // Always update src when card changes
        const fullUrl = audioUrl.startsWith('http') ? audioUrl : (R2Base ? R2Base + audioUrl : audioUrl);
        const currentSrc = audioRef.current.src;
        const currentBaseUrl = currentSrc.split('?')[0]; // Remove query params for comparison
        
        // Update src if different
        if (!currentSrc || (!currentBaseUrl.endsWith(audioUrl) && !currentBaseUrl.endsWith(fullUrl))) {
          audioRef.current.src = fullUrl;
        }
        audioRef.current.volume = (preferences.volume || 80) / 100;
        
        // Always play when card changes (will restart if already playing)
        audioRef.current.play().catch((error) => {
          console.error('Failed to play audio:', error);
          setIsAutoPlaying(false);
        });
      } else {
        setIsAutoPlaying(false);
      }
    }
  }, [currentCard, isAutoPlaying, preferences.volume]);

  // Sync isPlaying state from audio element events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  // Fetch review count when current card changes
  useEffect(() => {
    if (!user?.uid || !currentCard?.id) { setReviewCount(0); return; }
    apiGetCardSaveStatusBatch(user.uid, [currentCard.id]).then(states => {
      const s = states?.[currentCard.id];
      setReviewCount(s?.review_count ?? 0);
    }).catch(() => setReviewCount(0));
  }, [user?.uid, currentCard?.id]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // Play / pause toggle
  const handlePlayPause = useCallback(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  }, [isPlaying]);

  // Copy card link to clipboard
  const handleCopyLink = useCallback(() => {
    const url = `${window.location.origin}/watch/${contentId}?episode=${currentEpisode?.slug}&card=${currentCard?.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    });
  }, [contentId, currentEpisode, currentCard]);

  // Navigate to previous card
  const goToPrevCard = useCallback(() => {
    const cardsToUse = searchQuery.trim() ? filteredCards : cards;
    const cardIndexForNav = searchQuery.trim() ? (
      (() => {
        const originalCard = cards[currentCardIndex];
        const filteredIdx = originalCard ? filteredCards.findIndex(c => c.id === originalCard.id) : -1;
        return filteredIdx >= 0 ? filteredIdx : 0;
      })()
    ) : currentCardIndex;
    if (cardIndexForNav > 0) {
      const prevCard = cardsToUse[cardIndexForNav - 1];
      const prevOriginalIndex = cardIndexMap.get(prevCard.id) ?? -1;
      if (prevOriginalIndex >= 0) handleCardClick(prevOriginalIndex);
    }
  }, [cards, currentCardIndex, filteredCards, cardIndexMap, searchQuery, handleCardClick]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'a': {
          // Previous card (use filtered cards when searching)
          e.preventDefault();
          const cardsToUseForNav = searchQuery.trim() ? filteredCards : cards;
          const cardIndexForNav = searchQuery.trim() ? (
            (() => {
              const originalCard = cards[currentCardIndex];
              const filteredIdx = originalCard ? filteredCards.findIndex(c => c.id === originalCard.id) : -1;
              return filteredIdx >= 0 ? filteredIdx : 0;
            })()
          ) : currentCardIndex;
          if (cardIndexForNav > 0) {
            const prevCard = cardsToUseForNav[cardIndexForNav - 1];
            const prevOriginalIndex = cardIndexMap.get(prevCard.id) ?? -1;
            if (prevOriginalIndex >= 0) {
              handleCardClick(prevOriginalIndex);
            }
          }
          break;
        }
        case 'd':
          // Next card
          e.preventDefault();
          handleNextCard();
          break;
        case ' ':
          // Toggle auto-play
          e.preventDefault();
          handleAutoPlayToggle();
          break;
        case 'c':
          // Toggle completion status
          e.preventDefault();
          if (progress) {
            const isCompleted = progress.completed_indices.has(currentCardIndex);
            handleToggleComplete(!isCompleted);
          }
          break;
        case 'arrowleft':
          // Previous card (alternative)
          e.preventDefault();
          if (currentCardIndex > 0) {
            handleCardClick(currentCardIndex - 1);
          }
          break;
        case 'arrowright':
          // Next card (alternative)
          e.preventDefault();
          handleNextCard();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCardIndex, cards.length, progress, filteredCards, cardIndexMap, handleCardClick, handleNextCard, handleAutoPlayToggle, handleToggleComplete]);

  // Close tags dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsideTagsSection = tagsDropdownRef.current?.contains(target);
      const isInsideEpisodesPanel = episodesPanelRef.current?.contains(target);
      
      if (!isInsideTagsSection && !isInsideEpisodesPanel) {
        setTagsDropdownOpen(false);
      }
    };
    if (tagsDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [tagsDropdownOpen]);


  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  const totalCards = typeof currentEpisode?.num_cards === 'number' && currentEpisode.num_cards > 0
    ? currentEpisode.num_cards
    : cards.length;

  return (
    <div className="watch-page">
      <div className="watch-page-container">

        {/* Header */}
        <div className="watch-header">
          {/* Row 1: back + progress bar */}
          <div className="watch-header__top">
            <button
              className="watch-header__back"
              onClick={() => navigate(-1)}
            >
              <img src={rightAngleIcon} alt="" className="watch-header__back-icon" />
            </button>
            {!loadingProgress && progress && (
              <div className="watch-header__progress">
                <LearningProgressBar
                  totalCards={totalCards}
                  completedIndices={progress.completed_indices}
                  currentIndex={currentCardIndex}
                  onCardClick={handleCardClick}
                  className="watch-progress-bar"
                  filterIcon={filterIcon}
                  customIcon={customIcon}
                />
              </div>
            )}
          </div>
        </div>

        {/* Main Content Grid — 2 cols × 3 rows */}
        <div className="watch-grid">

          {/* Row 1: left=empty, right=search */}
          <div />
          <div className="watch-search">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="watch-search__input"
            />
            <button className="search-trigger-btn" type="button" aria-label="Search">
              <img src={searchIcon} alt="" className="search-trigger-icon" />
              <span className="search-trigger-text">Search</span>
            </button>
          </div>

          {/* Row 2: left=meta (card-metadata-top), right=lang selector */}
          <div className="watch-meta card-metadata-top">
            {/* Level badge */}
            {currentCard?.levels && currentCard.levels.length > 0 && (() => {
              const primaryLevel = currentCard.levels[0].level || "";
              const primaryFramework = currentCard.levels[0].framework || "CEFR";
              const colors = getLevelBadgeColors(primaryLevel);
              const freqEntry = currentCard.level_frequency_ranks?.find(
                (f) => f.framework === primaryFramework
              );
              const freqRank = freqEntry?.frequency_rank;
              return (
                <div
                  className="level-badges-container"
                  style={{ backgroundColor: colors.background, color: colors.color }}
                >
                  <span className="level-badge-label">{primaryLevel}</span>
                  <span className="level-badge-number">{freqRank != null ? Math.round(freqRank) : '—'}</span>
                </div>
              );
            })()}
            {/* Title chip */}
            <div className="card-title-chip">
              <span className="card-title-text">{film?.title || 'Loading...'}</span>
              <button
                type="button"
                className="card-star-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsStarred((prev) => !prev);
                }}
                aria-pressed={isStarred}
                aria-label={isStarred ? 'Unfavorite' : 'Favorite'}
              >
                <img
                  src={isStarred ? starFillIcon : starIcon}
                  alt=""
                  className={`card-star-icon ${isStarred ? 'card-star-icon-active' : ''}`}
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
          <div className="watch-lang-selector">
            <SubtitleLanguageSelector filmId={contentId} />
          </div>

          {/* Row 3: left=media+carousel, right=subtitle list */}
          <div className="watch-media-panel">
            <div className="watch-media">
              {currentCard ? (
                <>
                  {/* SRS dropdown */}
                  {(() => {
                    const cardState = cardSaveStates[currentCard.id];
                    const isSaved = cardState?.saved || false;
                    const srsState = cardState?.srsState || 'none';
                    return isSaved && srsState !== 'none' ? (
                      <div className="watch-srs-dropdown-container" ref={srsDropdownRef}>
                        <button
                          className={`watch-srs-dropdown-btn srs-${srsState}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSrsDropdownOpen(!srsDropdownOpen);
                          }}
                        >
                          <span className="watch-srs-dropdown-text">{SRS_STATE_LABELS[srsState]}</span>
                          <img src={buttonPlayIcon} alt="Dropdown" className="watch-srs-dropdown-icon" />
                        </button>
                        {srsDropdownOpen && (
                          <div className="watch-srs-dropdown-menu">
                            {SELECTABLE_SRS_STATES.map((state) => (
                              <button
                                key={state}
                                className={`watch-srs-dropdown-item srs-${state} ${srsState === state ? 'active' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSRSStateChange(currentCard, state);
                                }}
                              >
                                {SRS_STATE_LABELS[state]}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null;
                  })()}
                  {/* Card image with review count overlay */}
                  <div className="watch-media__img-wrapper">
                    {getCurrentCardImageUrl() ? (
                      <img
                        src={getCurrentCardImageUrl()}
                        alt={`Card ${searchQuery.trim() ? currentFilteredCardIndex + 1 : currentCardIndex + 1}`}
                        className="watch-media__img"
                      />
                    ) : (
                      <div className="watch-media-placeholder">
                        <p className="watch-media-placeholder-title">Card {searchQuery.trim() ? currentFilteredCardIndex + 1 : currentCardIndex + 1}</p>
                        <p className="watch-media-placeholder-subtitle">No image available</p>
                      </div>
                    )}
                    {user?.uid && (
                      <div className="card-review-count">
                        <img src={headphoneIcon} alt="" className="card-review-count-headphone" aria-hidden="true" />
                        <span>{reviewCount}</span>
                      </div>
                    )}
                  </div>
                  {/* Controls */}
                  <div className="watch-media__controls">
                    {/* Save button */}
                    <button
                      className={`watch-media__save ${cardSaveStates[currentCard.id]?.saved ? 'saved' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleSaveCard(currentCard, e);
                      }}
                      title={cardSaveStates[currentCard.id]?.saved ? "Unsave card" : "Save card"}
                    >
                      <img src={saveHeartIcon} alt="" className="watch-media__save-icon" />
                      <span className="watch-media__save-text">
                        {cardSaveStates[currentCard.id]?.saved ? 'Saved' : 'Save'}
                      </span>
                    </button>

                    <div className="watch-media__divider" />

                    {/* Playback group */}
                    <div className="watch-media__playback">
                      <button
                        className="watch-media__icon-btn"
                        onClick={(e) => { e.stopPropagation(); goToPrevCard(); }}
                        title="Previous card (A)"
                      >
                        <img src={rightAngleIcon} alt="Previous" className="watch-media__nav-icon watch-media__nav-prev" />
                      </button>

                      <button
                        className="watch-media__icon-btn"
                        onClick={(e) => { e.stopPropagation(); handlePlayPause(); }}
                        title={isPlaying ? "Pause" : "Play"}
                      >
                        <img
                          src={isPlaying ? buttonPauseIcon : buttonPlayIcon}
                          alt={isPlaying ? "Pause" : "Play"}
                          className={`watch-media__play-icon ${isPlaying ? 'playing' : ''}`}
                        />
                      </button>

                      <button
                        className="watch-media__icon-btn"
                        onClick={(e) => { e.stopPropagation(); handleNextCard(); }}
                        title="Next card (D)"
                      >
                        <img src={rightAngleIcon} alt="Next" className="watch-media__nav-icon watch-media__nav-next" />
                      </button>
                    </div>

                    <div className="watch-media__divider" />

                    {/* Link button */}
                    <button
                      className={`watch-media__icon-btn ${linkCopied ? 'copied' : ''}`}
                      onClick={(e) => { e.stopPropagation(); handleCopyLink(); }}
                      title={linkCopied ? "Copied!" : "Copy link"}
                    >
                      <img src={linkIcon} alt="Copy link" className="watch-media__action-icon" />
                      <span className="watch-media__tooltip">{linkCopied ? 'Copied!' : 'Copy'}</span>
                    </button>

                    {/* Flag button */}
                    <button
                      className="watch-media__icon-btn"
                      onClick={(e) => { e.stopPropagation(); alert('Report feature coming soon!'); }}
                      title="Report issue"
                    >
                      <img src={flagIcon} alt="Flag" className="watch-media__action-icon" />
                    </button>

                    {/* More options */}
                    <div className="watch-media__menu-container" ref={menuRef}>
                      <button
                        className="watch-media__icon-btn"
                        onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
                        title="More options"
                        aria-expanded={menuOpen}
                      >
                        <img src={threeDotsIcon} alt="More" className="watch-media__dots-icon" />
                      </button>
                      {menuOpen && (
                        <div className="watch-media__menu-dropdown">
                          <div
                            className="watch-media__menu-item"
                            onClick={() => {
                              setMenuOpen(false);
                              if (contentId && currentEpisode) {
                                navigate(`/watch/${contentId}?episode=${currentEpisode.slug}&card=${currentCard?.id}`);
                              }
                            }}
                          >
                            <img src={eyeIcon} alt="View" className="watch-media__menu-icon" />
                            View Card
                          </div>
                          <div
                            className="watch-media__menu-item"
                            onClick={() => {
                              setMenuOpen(false);
                              alert('Report Issues feature coming soon!');
                            }}
                          >
                            <img src={warningIcon} alt="Report" className="watch-media__menu-icon" />
                            Report Issues
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="watch-media__spacer" />

                    {/* Counter */}
                    <span className="watch-media__counter">
                      {searchQuery.trim() ? currentFilteredCardIndex + 1 : currentCardIndex + 1}/{searchQuery.trim() ? filteredCards.length : totalCards}
                    </span>

                    {/* Auto-play button — rightmost */}
                    <button
                      className={`watch-media__autoplay ${isAutoPlaying ? 'active' : ''}`}
                      onClick={(e) => { e.stopPropagation(); handleAutoPlayToggle(); }}
                      title={isAutoPlaying ? "Stop auto-play" : "Start auto-play"}
                    >
                      <img src={buttonAutoplayPrimaryIcon} alt="Auto-play" className="watch-media__autoplay-icon" />
                      <span>Auto-play</span>
                    </button>

                    {getCurrentCardAudioUrl() && (
                      <audio ref={audioRef} onEnded={handleAutoPlayAudioEnd} preload="auto" style={{ display: 'none' }} />
                    )}
                  </div>
                </>
              ) : (
                <div className="watch-no-media">
                  <p className="text-white">No cards available for this episode</p>
                </div>
              )}
            </div>

            {/* Carousel */}
            <div className="watch-carousel" ref={carouselRef}>
              {cardsToRender.map((card, index) => {
                const originalIndex = cardIndexMap.get(card.id) ?? -1;
                const isActive = searchQuery.trim()
                  ? index === currentFilteredCardIndex
                  : index === currentCardIndex;
                const isCompleted = originalIndex >= 0 && progress?.completed_indices.has(originalIndex) || false;
                const imageUrl = card.image_url
                  ? (card.image_url.startsWith('/') && R2Base ? R2Base + card.image_url : card.image_url)
                  : '';
                return (
                  <button
                    key={card.id}
                    data-card-index={originalIndex >= 0 ? originalIndex : index}
                    onClick={() => handleCardClick(originalIndex >= 0 ? originalIndex : index)}
                    className={`watch-carousel__thumb ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
                  >
                    <img
                      src={imageUrl || '/placeholder-image.jpg'}
                      alt={`Card ${index + 1}`}
                      className="watch-carousel__thumb-img"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const placeholder = target.nextElementSibling as HTMLElement;
                        if (placeholder && placeholder.classList.contains('watch-carousel__thumb-placeholder')) {
                          placeholder.style.display = 'flex';
                        }
                      }}
                    />
                    <div className="watch-carousel__thumb-placeholder" style={{ display: imageUrl ? 'none' : 'flex' }}>
                      <span className="text-xs">{index + 1}</span>
                    </div>
                  </button>
                );
              })}
              {loadingMoreCards && (
                <div className="watch-carousel__loading">
                  <div className="watch-loading-spinner" />
                  <span className="text-xs text-pink-200">Loading...</span>
                </div>
              )}
              {noMoreCards && (
                <div className="watch-carousel__end">
                  <span className="text-xs text-gray-400">End of episode</span>
                </div>
              )}
            </div>
          </div>

          {/* Right column — subtitle list */}
          <div className="watch-list">
            {cardsToRender.length > 0 ? (
              <List
                ref={subtitlesListRef}
                height={480}
                itemCount={cardsToRender.length}
                itemSize={getItemSize}
                estimatedItemSize={ESTIMATED_HEIGHT}
                overscanCount={5}
                width="100%"
              >
                {SubtitleRow}
              </List>
            ) : (
              <div className="watch-list__empty">
                <p>No subtitles available</p>
              </div>
            )}
            {noMoreCards && cards.length > 0 && (
              <div className="watch-list__end">
                <img src={enterMovieViewIcon} alt="End" className="watch-list__end-icon" />
                <p className="watch-list__end-text">End of Episode</p>
                <p className="watch-list__end-subtext">
                  You've completed all {currentEpisode?.num_cards || cards.length} cards
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Title — below grid, above tags */}
        <h1 className="watch-header__title">
          {film?.title || 'Loading...'}
        </h1>

        {/* Tags Section */}
        <div className="watch-tags-section" ref={tagsDropdownRef}>
          <button 
            className="watch-tag-dropdown-btn"
            onClick={() => setTagsDropdownOpen(!tagsDropdownOpen)}
          >
            <span>Season</span>
            <img 
              src={rightAngleIcon} 
              alt="Dropdown" 
              className={`watch-tag-dropdown-icon ${tagsDropdownOpen ? 'expanded' : 'collapsed'}`}
            />
          </button>
          
          {/* Category tags - inline with dropdown button */}
          {film?.categories && film.categories.length > 0 ? (
            film.categories.map((category) => (
              <span key={category.id} className="watch-tag-category">
                {category.name}
              </span>
            ))
          ) : null}
        </div>

        {/* Episodes Panel - toggled by dropdown */}
        {tagsDropdownOpen && (
          <div className="watch-episodes-panel" ref={episodesPanelRef}>
            <div className="watch-episodes-carousel-wrapper">
              {episodes.map((episode) => {
                const isCurrent = currentEpisode?.episode_number === episode.episode_number;
                
                return (
                  <div
                    key={episode.episode_number}
                    className={`watch-episode-item ${isCurrent ? 'expanded' : ''}`}
                    onClick={() => {
                      // Navigate to episode immediately
                      handleEpisodeClick(episode);
                    }}
                  >
                    {/* Episode thumbnail */}
                    <div className="watch-episode-thumbnail">
                      {getCoverUrl(episode) ? (
                        <img
                          src={getCoverUrl(episode)}
                          alt={episode.title || `Episode ${episode.episode_number}`}
                          className="watch-episode-thumbnail-image"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            const placeholder = target.nextElementSibling as HTMLElement;
                            if (placeholder && placeholder.classList.contains('watch-episode-thumbnail-placeholder')) {
                              placeholder.style.display = 'flex';
                            }
                          }}
                        />
                      ) : null}
                      <div className="watch-episode-thumbnail-placeholder" style={{ display: getCoverUrl(episode) ? 'none' : 'flex' }}>
                        <span>{episode.episode_number}</span>
                      </div>
                    </div>

                    {/* Expanded Episode Info Panel */}
                    {isCurrent && (
                      <div className="watch-episode-detail-panel">
                        <h2 className="watch-episode-detail-title">
                          {episode.episode_number}. Episode {episode.episode_number}
                        </h2>
                        <p className="watch-episode-detail-description">
                          {episode.description || 'No description available.'}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Bottom Section: Comments and Recommendations */}
        <div className="watch-bottom-section">
          {/* Comments Section */}
          <div className="watch-comments-section">
            <div className="watch-section-header">
              <img src={commentIcon} alt="Comment" className="watch-section-header-icon" />
              <h3 className="watch-section-title">Comment</h3>
              <span className="watch-section-count">(ෆ˙ᵕ˙ෆ)♡</span>
            </div>
            {user && (
              <div className="watch-comment-input">
                <div className="watch-comment-input-row-1">
                  <div className="watch-comment-name-wrapper">
                    <Globe size={16} className="watch-comment-name-icon" />
                    <span className="watch-comment-name typography-montserrat-comment-name">
                      {user.displayName || user.email || 'Me'}
                    </span>
                  </div>
                </div>
                <div className="watch-comment-input-row-2">
                  <input
                    type="text"
                    placeholder="comment..."
                    value={newCommentText}
                    onChange={(e) => setNewCommentText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSubmitComment();
                      }
                    }}
                    className="watch-comment-input-field"
                    disabled={submittingComment}
                  />
                  <button 
                    className="watch-comment-send-btn"
                    onClick={handleSubmitComment}
                    disabled={submittingComment || !newCommentText.trim()}
                  >
                    <img src={commentPostIcon} alt="Post" className="watch-comment-send-icon" />
                  </button>
                </div>
              </div>
            )}
            <div className="watch-comments-list">
              {loadingComments ? (
                <div className="watch-comment-loading">Loading comments...</div>
              ) : comments.length === 0 ? (
                <div className="watch-comment-empty">No comments yet. Be the first to comment!</div>
              ) : (
                comments.map((comment) => {
                  const userVote = commentVotes[comment.id] || null;
                  return (
                    <div key={comment.id} className="watch-comment-item">
                      <div className="watch-comment-content">
                        <div className="watch-comment-name-wrapper">
                          <Globe size={16} className="watch-comment-name-icon" />
                          <span className="watch-comment-name typography-montserrat-comment-name">
                            {comment.display_name || 'Anonymous'}
                          </span>
                        </div>
                        <p className="watch-comment-meta typography-montserrat-comment-meta">
                          {comment.text}
                        </p>
                      </div>
                      <div className="watch-comment-votes">
                        <button 
                          className={`watch-vote-btn ${userVote === 1 ? 'active upvoted' : ''}`}
                          onClick={() => handleVoteComment(comment.id, 1)}
                          disabled={!user}
                        >
                          <span className="watch-vote-count">{comment.upvotes}</span>
                          <img src={upvoteIcon} alt="Upvote" className="watch-vote-icon" />
                        </button>
                        <button 
                          className={`watch-vote-btn ${userVote === -1 ? 'active downvoted' : ''}`}
                          onClick={() => handleVoteComment(comment.id, -1)}
                          disabled={!user}
                        >
                          <span className="watch-vote-count">{comment.downvotes}</span>
                          <img src={downvoteIcon} alt="Downvote" className="watch-vote-icon" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Recommendations Section */}
          <div className="watch-recommendations-section">
            <div className="watch-section-header">
              <img src={recommendationIcon} alt="Recommendation" className="watch-section-header-icon" />
              <h3 className="watch-section-title">Recommendation</h3>
            </div>
            <div className="watch-recommendations-list">
              {loadingRecommendations ? (
                <div className="watch-recommendation-loading">Loading recommendations...</div>
              ) : recommendations.length === 0 ? (
                <div className="watch-recommendation-empty">No recommendations available</div>
              ) : (
                recommendations.map((item) => {
                  const coverUrl = item.cover_url || '';
                  const fullCoverUrl = coverUrl.startsWith('/') && R2Base ? R2Base + coverUrl : coverUrl;

                  const dominantLevel = (() => {
                    const stats = parseLevelStats(item.level_framework_stats);
                    if (!stats || !Array.isArray(stats) || stats.length === 0) return null;
                    let maxLevel: string | null = null;
                    let maxPercent = 0;
                    for (const entry of stats) {
                      if (!entry.levels || typeof entry.levels !== 'object') continue;
                      for (const [level, percent] of Object.entries(entry.levels)) {
                        if (typeof percent === 'number' && percent > maxPercent) {
                          maxPercent = percent;
                          maxLevel = level;
                        }
                      }
                    }
                    return maxLevel;
                  })();
                  
                  return (
                    <div 
                      key={item.id} 
                      className="watch-recommendation-item"
                      onClick={() => navigate(`/watch/${item.id}`)}
                      style={{ cursor: 'pointer' }}
                    >
                      {/* Left section - Image (20%) */}
                      <div className="watch-recommendation-left">
                        {fullCoverUrl ? (
                          <img
                            src={fullCoverUrl}
                            alt={item.title || 'Recommendation'}
                            className="watch-recommendation-image"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : null}
                      </div>
                      
                      {/* Right section - Content (80%) */}
                      <div className="watch-recommendation-right">
                        <div className="watch-recommendation-header">
                          <h4 className="watch-recommendation-title">{item.title || 'Untitled'}</h4>
                          {dominantLevel && (
                            <span className={`level-badge level-${dominantLevel.toLowerCase()}`}>
                              {dominantLevel.toUpperCase()}
                            </span>
                          )}
                        </div>
                        <p className="watch-recommendation-meta">{item.description || ''}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
