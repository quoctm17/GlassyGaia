import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Globe } from 'lucide-react';
import type { FilmDoc, EpisodeDetailDoc, CardDoc, GetProgressResponse, LevelFrameworkStats } from '../types';
import { 
  apiGetFilm, 
  apiListEpisodes, 
  apiFetchCardsForFilm,
  apiGetEpisodeComments,
  apiCreateEpisodeComment,
  apiVoteEpisodeComment,
  apiGetEpisodeCommentVotes,
  apiToggleSaveCard,
  apiGetCardSaveStatus,
  apiUpdateCardSRSState,
  apiListItems,
  type EpisodeComment
} from '../services/cfApi';
import { SELECTABLE_SRS_STATES, SRS_STATE_LABELS, type SRSState } from '../types/srsStates';
import { getEpisodeProgress, markCardComplete, markCardIncomplete } from '../services/userProgress';
import { useUser } from '../context/UserContext';
import LearningProgressBar from '../components/LearningProgressBar';
import { canonicalizeLangCode, langLabel } from '../utils/lang';
import { normalizeCjkSpacing } from '../utils/subtitles';
import rightAngleIcon from '../assets/icons/right-angle.svg';
import filterIcon from '../assets/icons/filter.svg';
import customIcon from '../assets/icons/custom.svg';
import saveHeartIcon from '../assets/icons/save-heart.svg';
import threeDotsIcon from '../assets/icons/three-dots.svg';
import buttonPlayIcon from '../assets/icons/button-play.svg';
import enterMovieViewIcon from '../assets/icons/enter-movie-view.svg';
import commentIcon from '../assets/icons/comment.svg';
import commentPostIcon from '../assets/icons/comment-post.svg';
import recommendationIcon from '../assets/icons/recommendation.svg';
import upvoteIcon from '../assets/icons/upvote.svg';
import downvoteIcon from '../assets/icons/downvote.svg';
import searchIcon from '../assets/icons/search.svg';
import '../styles/pages/watch-page.css';

export default function WatchPage() {
  const { contentId } = useParams<{ contentId: string }>();
  const navigate = useNavigate();
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

  const R2Base = (import.meta.env.VITE_R2_PUBLIC_BASE as string | undefined)?.replace(/\/$/, '') || '';

  // Auto-scroll carousel and subtitle list when card changes
  useEffect(() => {
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
      const container = cardElement.closest('.watch-subtitles-list') as HTMLElement;
      if (container) {
        // Calculate position to center the card in the visible viewport
        const containerHeight = container.clientHeight;
        const cardOffsetTop = cardElement.offsetTop;
        const cardHeight = cardElement.offsetHeight;
        
        // Center position: scroll so card is in middle of visible area
        const scrollPosition = cardOffsetTop - (containerHeight / 2) + (cardHeight / 2);
        
        container.scrollTo({ top: scrollPosition, behavior: 'smooth' });
      }
    }
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
            
            for (const card of moreCards) {
              const k = key(card);
              if (!seen.has(k)) {
                merged.push(card);
                seen.add(k);
              }
            }
            
            // Sort by start time
            merged.sort((a, b) => (a.start - b.start) || (a.end - b.end));
            setCards(merged);
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
        
        // Set first episode as current
        if (episodesData.length > 0) {
          setCurrentEpisode(episodesData[0]);
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
    if (searchQuery.trim()) {
      return;
    }

    const loadCardSaveStates = async () => {
      const states: Record<string, { saved: boolean; srsState: SRSState }> = {};
      
      // Batch requests to avoid ERR_INSUFFICIENT_RESOURCES
      // Process 15 cards at a time
      const batchSize = 15;
      for (let i = 0; i < cards.length; i += batchSize) {
        const batch = cards.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (card) => {
            try {
              // Ensure we have film_id and episode_id - use currentEpisode and contentId if card doesn't have them
              const filmId = card.film_id || contentId || '';
              const episodeId = card.episode_id || (typeof card.episode === 'number' ? `e${card.episode}` : String(card.episode || '')) || (currentEpisode?.slug || '');
              
              if (!filmId || !episodeId) {
                states[card.id] = { saved: false, srsState: 'none' };
                return;
              }
              
              const status = await apiGetCardSaveStatus(
                user.uid,
                card.id,
                filmId,
                episodeId
              );
              states[card.id] = {
                saved: status.saved,
                srsState: status.srs_state as SRSState,
              };
            } catch (error) {
              console.error(`Failed to load save status for card ${card.id}:`, error);
              states[card.id] = { saved: false, srsState: 'none' };
            }
          })
        );
        
        // Small delay between batches to avoid overwhelming the browser
        if (i + batchSize < cards.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      setCardSaveStates(states);
    };

    loadCardSaveStates();
  }, [user?.uid, cards, contentId, currentEpisode, searchQuery]);

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

  // Parse level framework stats helper
  const parseLevelStats = (raw: unknown): LevelFrameworkStats | null => {
    if (!raw) return null;
    if (Array.isArray(raw)) return raw as LevelFrameworkStats;
    if (typeof raw === 'string') {
      try {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr as LevelFrameworkStats : null;
      } catch {
        return null;
      }
    }
    return null;
  };

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
        const sorted = [...cardsData].sort((a, b) => {
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
        
        // Load user progress for this episode
        if (user?.uid) {
          setLoadingProgress(true);
          try {
            const progressData = await getEpisodeProgress(user.uid, contentId, currentEpisode.slug);
            setProgress(progressData);
            
            // Resume from last card if user has progress
            if (progressData.episode_stats && progressData.episode_stats.last_card_index > 0) {
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
                  
                  for (const card of batchCards) {
                    const k = key(card);
                    if (!seen.has(k)) {
                      allCards.push(card);
                      seen.add(k);
                    }
                  }
                  
                  allCards.sort((a, b) => (a.start - b.start) || (a.end - b.end));
                  
                  // Update cards state periodically (every 100 cards)
                  setCards([...allCards]);
                  
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
  }, [contentId, currentEpisode, user]);

  // Toggle card completion status
  const handleToggleComplete = async (markAsComplete: boolean) => {
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
  };


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
    
    // If clicking the same vote type, remove the vote
    // Otherwise, change to the new vote type
    const newVoteType = currentVote === voteType ? null : voteType;

    try {
      if (newVoteType === null) {
        // Remove vote: send the same vote type again to toggle it off
        await apiVoteEpisodeComment({
          userId: user.uid,
          commentId,
          voteType,
        });
      } else {
        // Change vote: API will handle switching from one type to another
        await apiVoteEpisodeComment({
          userId: user.uid,
          commentId,
          voteType: newVoteType,
        });
      }

      // Reload comments to get updated scores (sorted by score DESC)
      if (currentEpisode?.slug && contentId) {
        const updatedComments = await apiGetEpisodeComments(currentEpisode.slug, contentId);
        setComments(updatedComments);

        // Reload votes
        if (updatedComments.length > 0) {
          const commentIds = updatedComments.map(c => c.id);
          const votes = await apiGetEpisodeCommentVotes(user.uid, commentIds);
          setCommentVotes(votes);
        }
      }
    } catch (error) {
      console.error('Failed to vote on comment:', error);
    }
  };

  // Handle save/unsave card (same logic as SearchResultCard)
  const handleToggleSaveCard = async (card: CardDoc, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user?.uid || !card.id) return;
    
    try {
      // Ensure we have film_id and episode_id - use currentEpisode and contentId if card doesn't have them
      const filmId = card.film_id || contentId || '';
      const episodeId = card.episode_id || (typeof card.episode === 'number' ? `e${card.episode}` : String(card.episode || '')) || (currentEpisode?.slug || '');
      
      if (!filmId || !episodeId) {
        console.error('Missing film_id or episode_id:', { filmId, episodeId, card });
        return;
      }
      
      const result = await apiToggleSaveCard(
        user.uid,
        card.id,
        filmId,
        episodeId
      );
      
      setCardSaveStates(prev => ({
        ...prev,
        [card.id]: {
          saved: result.saved,
          srsState: result.saved ? 'new' : 'none',
        },
      }));
      
      if (!result.saved) {
        setSrsDropdownOpen(false);
      }
    } catch (error) {
      console.error('Failed to toggle save card:', error);
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

  const handleCardClick = (index: number) => {
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
            
            for (const card of moreCards) {
              const k = key(card);
              if (!seen.has(k)) {
                merged.push(card);
                seen.add(k);
              }
            }
            
            merged.sort((a, b) => (a.start - b.start) || (a.end - b.end));
            setCards(merged);
            
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
  };

  const handleNextCard = () => {
    // Use filtered cards when searching
    const cardsToUse = searchQuery.trim() ? filteredCards : cards;
    const currentIndexInCardsToUse = searchQuery.trim() ? currentFilteredCardIndex : currentCardIndex;
    
    if (currentIndexInCardsToUse < cardsToUse.length - 1) {
      // Move to next card in filtered/all cards
      const nextCard = cardsToUse[currentIndexInCardsToUse + 1];
      const nextOriginalIndex = cards.findIndex(c => c.id === nextCard.id);
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
              
              for (const card of moreCards) {
                const k = key(card);
                if (!seen.has(k)) {
                  merged.push(card);
                  seen.add(k);
                }
              }
              
              merged.sort((a, b) => (a.start - b.start) || (a.end - b.end));
              setCards(merged);
              
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
  };

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

  // Get subtitle text for a card
  const getSubtitleText = (card: CardDoc, lang: string): string => {
    return card.subtitle?.[lang] || '';
  };

  // Get main language subtitle (from film main_language)
  const mainLanguage = film?.main_language || 'en';
  
  // Subtitle languages selected from user preferences (for secondary subtitles)
  const subtitleLanguages = preferences?.subtitle_languages || [];

  // Filter cards based on search query
  const filteredCards = useMemo(() => {
    if (!searchQuery.trim()) {
      return cards;
    }
    
    const query = searchQuery.toLowerCase();
    return cards.filter((card) => {
      const mainText = getSubtitleText(card, mainLanguage);
      const selectedSubtitleLangs = subtitleLanguages.filter(
        (lang) => lang && lang !== mainLanguage
      );
      
      const subtitleTextsForSearch = [
        mainText,
        ...selectedSubtitleLangs.map((lang) => getSubtitleText(card, lang) || ''),
      ];
      
      return subtitleTextsForSearch.some((text) =>
        text.toLowerCase().includes(query)
      );
    });
  }, [cards, searchQuery, mainLanguage, subtitleLanguages]);

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
      const firstOriginalIndex = cards.findIndex(c => c.id === firstFilteredCard.id);
      return firstOriginalIndex >= 0 ? cards[firstOriginalIndex] : null;
    }
    return null;
  }, [cards, currentCardIndex, filteredCards, searchQuery]);

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

  // Map language code to CSS class name (same as SearchResultCard)
  const codeToName = (code: string): string => {
    const c = (canonicalizeLangCode(code) || code).toLowerCase();
    const map: Record<string, string> = {
      en: "english",
      vi: "vietnamese",
      zh: "chinese",
      zh_trad: "chinese-tc",
      yue: "cantonese",
      ja: "japanese",
      ko: "korean",
      es: "spanish",
      ar: "arabic",
      th: "thai",
      fr: "french",
      de: "german",
      el: "greek",
      hi: "hindi",
      id: "indonesian",
      it: "italian",
      ms: "malay",
      nl: "dutch",
      pl: "polish",
      pt: "portuguese",
      ru: "russian",
      he: "hebrew",
      fil: "filipino",
      fi: "finnish",
      hu: "hungarian",
      is: "icelandic",
      ml: "malayalam",
      no: "norwegian",
      ro: "romanian",
      sv: "swedish",
      tr: "turkish",
      uk: "ukrainian",
      eu: "basque",
      bn: "bengali",
      ca: "catalan",
      hr: "croatian",
      cs: "czech",
      da: "danish",
      gl: "galician",
      "pt-br": "portuguese-br",
      "pt-pt": "portuguese-pt",
      "es-la": "spanish-la",
      "es-es": "spanish-es",
      ta: "tamil",
      te: "telugu",
    };
    return map[c] || c;
  };

  // ===== Ruby / CJK subtitle helpers (shared concept with SearchResultCard) =====
  const escapeHtml = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const escapeRegExp = (s: string): string => {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };

  // Normalize Japanese text for comparison: Katakana → Hiragana, remove whitespace, remove furigana brackets
  const normalizeJapanese = (text: string): string => {
    try {
      const withoutTags = text.replace(/<[^>]+>/g, '');
      const nfkc = withoutTags.normalize('NFKC').replace(/\s+/g, '').replace(/\[[^\]]+\]/g, '');
      return nfkc.replace(/[\u30A1-\u30F6]/g, (ch) => 
        String.fromCharCode(ch.charCodeAt(0) - 0x60)
      );
    } catch {
      return text.replace(/<[^>]+>/g, '').replace(/\s+/g, '').replace(/\[[^\]]+\]/g, '').replace(/[\u30A1-\u30F6]/g, (ch) => 
        String.fromCharCode(ch.charCodeAt(0) - 0x60)
      );
    }
  };

  // Check if text contains Japanese characters
  const hasJapanese = (text: string): boolean => {
    return /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(text);
  };

  // Helper to normalize a single character (Katakana → Hiragana, NFKC)
  const normChar = (ch: string): string => {
    try {
      const nfkc = ch.normalize('NFKC');
      return nfkc.replace(/[\u30A1-\u30F6]/g, (c) => 
        String.fromCharCode(c.charCodeAt(0) - 0x60)
      );
    } catch {
      return ch.replace(/[\u30A1-\u30F6]/g, (c) => 
        String.fromCharCode(c.charCodeAt(0) - 0x60)
      );
    }
  };

  // Highlight query occurrences with a styled span; case-insensitive
  const highlightHtml = (text: string, q: string): string => {
    if (!q) return escapeHtml(text);
    try {
      if (hasJapanese(q) || hasJapanese(text)) {
        const qNorm = normalizeJapanese(q.trim());
        const posMap: number[] = [];
        let normalized = '';
        
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (/\s/.test(ch) || ch === '[' || ch === ']') continue;
          if (i > 0 && text.lastIndexOf('[', i) > text.lastIndexOf(']', i)) continue;
          
          const norm = normChar(ch);
          for (let j = 0; j < norm.length; j++) {
            normalized += norm[j];
            posMap.push(i);
          }
        }
        
        const matchIdx = normalized.indexOf(qNorm);
        if (matchIdx === -1) return escapeHtml(text);
        
        const startPos = posMap[matchIdx];
        const lastNormIdx = matchIdx + qNorm.length - 1;
        const lastOrigPos = posMap[lastNormIdx];
        
        let endPosExclusive = lastOrigPos + 1;
        for (let i = lastNormIdx + 1; i < posMap.length; i++) {
          if (posMap[i] === lastOrigPos) continue;
          else {
            endPosExclusive = posMap[i];
            break;
          }
        }
        
        const before = text.slice(0, startPos);
        const match = text.slice(startPos, endPosExclusive);
        const after = text.slice(endPosExclusive);
        
        return `${escapeHtml(before)}<span style="color: var(--hover-select)">${escapeHtml(match)}</span>${escapeHtml(after)}`;
      }
      
      const re = new RegExp(escapeRegExp(q), "gi");
      return escapeHtml(text).replace(
        re,
        (match) => `<span style="color: var(--hover-select)">${escapeHtml(match)}</span>`
      );
    } catch (err) {
      console.warn('Highlight error:', err);
      return escapeHtml(text);
    }
  };

  // Highlight occurrences inside already-safe HTML (e.g., ruby markup) without escaping tags
  const highlightInsideHtmlPreserveTags = (html: string, q: string, lang?: string): string => {
    if (!q) return html;
    try {
      if (lang === 'ja' || hasJapanese(q)) {
        const qNorm = normalizeJapanese(q.trim());
        if (!qNorm) return html;

        const rubyRe = /<ruby>\s*<rb>([\s\S]*?)<\/rb>\s*<rt>([\s\S]*?)<\/rt>\s*<\/ruby>/gi;
        let hasRubyHighlights = false;
        const processed = html.replace(rubyRe, (m, rbContent, rtContent) => {
          const rbNorm = normalizeJapanese(rbContent);
          const rtNorm = normalizeJapanese(rtContent);
          if (!rbNorm && !rtNorm) return m;
          if (rtNorm.includes(qNorm) || rbNorm.includes(qNorm)) {
            hasRubyHighlights = true;
            return `<ruby><rb><span style="color: var(--hover-select)">${rbContent}</span></rb><rt><span style="color: var(--hover-select)">${rtContent}</span></rt></ruby>`;
          }
          return m;
        });

        if (hasRubyHighlights) return processed;

        // Fallback: visible text approach
        const visibleChars: { char: string; htmlPos: number }[] = [];
        let i = 0;
        let inRtTag = false;

        while (i < html.length) {
          const char = html[i];
          if (char === '<') {
            const rtMatch = html.substring(i).match(/^<rt>/);
            const rtCloseMatch = html.substring(i).match(/^<\/rt>/);
            if (rtMatch) { inRtTag = true; i += rtMatch[0].length; continue; }
            if (rtCloseMatch) { inRtTag = false; i += rtCloseMatch[0].length; continue; }
            while (i < html.length && html[i] !== '>') i++;
            if (i < html.length && html[i] === '>') i++;
            continue;
          }
          if (inRtTag) { i++; continue; }
          if (/\s/.test(char)) { i++; continue; }
          visibleChars.push({ char, htmlPos: i });
          i++;
        }

        const posMap: number[] = [];
        let normalized = '';
        for (let vi = 0; vi < visibleChars.length; vi++) {
          const norm = normChar(visibleChars[vi].char);
          for (let j = 0; j < norm.length; j++) { normalized += norm[j]; posMap.push(vi); }
        }

        const matchIdx = normalized.indexOf(qNorm);
        if (matchIdx === -1) return html;
        const lastNormIdx = matchIdx + qNorm.length - 1;
        const startVisIdx = posMap[matchIdx];
        const lastVisIdx = posMap[lastNormIdx];
        let endVisIdxExclusive = lastVisIdx + 1;
        for (let k = lastNormIdx + 1; k < posMap.length; k++) {
          if (posMap[k] !== lastVisIdx) { endVisIdxExclusive = posMap[k]; break; }
        }

        let result = '';
        let htmlIdx = 0;
        let inRtTag2 = false;
        const charPositions = new Set(visibleChars.slice(startVisIdx, endVisIdxExclusive).map(v => v.htmlPos));
        while (htmlIdx < html.length) {
          const c = html[htmlIdx];
          if (c === '<') {
            const rtMatch = html.substring(htmlIdx).match(/^<rt>/);
            const rtCloseMatch = html.substring(htmlIdx).match(/^<\/rt>/);
            if (rtMatch) { result += rtMatch[0]; inRtTag2 = true; htmlIdx += rtMatch[0].length; continue; }
            if (rtCloseMatch) { result += rtCloseMatch[0]; inRtTag2 = false; htmlIdx += rtCloseMatch[0].length; continue; }
            const tagStart = htmlIdx; htmlIdx++;
            while (htmlIdx < html.length && html[htmlIdx] !== '>') htmlIdx++;
            if (htmlIdx < html.length && html[htmlIdx] === '>') htmlIdx++;
            result += html.substring(tagStart, htmlIdx);
            continue;
          }
          const shouldHighlight = !inRtTag2 && charPositions.has(htmlIdx);
          result += shouldHighlight ? `<span style="color: var(--hover-select)">${c}</span>` : c;
          htmlIdx++;
        }
        return result;
      }
      
      const re = new RegExp(escapeRegExp(q), "gi");
      return html.replace(re, (match) => `<span style="color: var(--hover-select)">${match}</span>`);
    } catch (err) {
      console.warn('Highlight error:', err);
      return html;
    }
  };

  // Convert [reading] annotations to <ruby> for Japanese / Chinese subtitles
  const bracketToRubyHtml = (text: string, lang?: string): string => {
    if (!text) return '';
    const re = /([^\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000[]+)\s*\[([^\]]+)\]/g;
    let last = 0;
    let out = '';
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out += escapeHtml(text.slice(last, m.index));
      const base = m[1];
      const reading = m[2];
      const hasKanji = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(base);
      const readingIsKanaOnly = /^[\u3040-\u309F\u30A0-\u30FFー]+$/.test(reading);

      if (lang === 'ja' && hasKanji && readingIsKanaOnly) {
        const simplePattern =
          /^([\u3040-\u309F\u30A0-\u30FFー]+)?([\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+)([\u3040-\u309F\u30A0-\u30FFー]+)?$/;
        const sp = base.match(simplePattern);
        if (sp) {
          const prefixKana = sp[1] || '';
          const kanjiPart = sp[2];
          const trailingKana = sp[3] || '';
          let readingCore = reading;
          if (trailingKana && readingCore.endsWith(trailingKana)) {
            readingCore = readingCore.slice(0, readingCore.length - trailingKana.length);
          }
          if (prefixKana) out += escapeHtml(prefixKana);
          out += `<ruby><rb>${escapeHtml(kanjiPart)}</rb><rt>${escapeHtml(readingCore)}</rt></ruby>`;
          if (trailingKana) out += `<span class="okurigana">${escapeHtml(trailingKana)}</span>`;
        } else {
          out += `<ruby><rb>${escapeHtml(base)}</rb><rt>${escapeHtml(reading)}</rt></ruby>`;
        }
      } else {
        out += `<ruby><rb>${escapeHtml(base)}</rb><rt>${escapeHtml(reading)}</rt></ruby>`;
      }
      last = m.index + m[0].length;
    }
    out += escapeHtml(text.slice(last));
    return out;
  };

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

  // Toggle auto-play
  const handleAutoPlayToggle = () => {
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
  };

  // Play audio of current card
  const playCurrentCardAudio = () => {
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
  };

  // Handle auto-play audio end - auto advance to next filtered card
  const handleAutoPlayAudioEnd = async () => {
    if (!isAutoPlaying) return;
    
    // Use filtered cards when searching
    const cardsToUse = searchQuery.trim() ? filteredCards : cards;
    const currentIndexInCardsToUse = searchQuery.trim() ? currentFilteredCardIndex : currentCardIndex;
    
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
      const nextOriginalIndex = cards.findIndex(c => c.id === nextCard.id);
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
              
              for (const card of moreCards) {
                const k = key(card);
                if (!seen.has(k)) {
                  merged.push(card);
                  seen.add(k);
                }
              }
              
              merged.sort((a, b) => (a.start - b.start) || (a.end - b.end));
              setCards(merged);
              
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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'a':
          // Previous card (use filtered cards when searching)
          e.preventDefault();
          const cardsToUseForNav = searchQuery.trim() ? filteredCards : cards;
          const cardIndexForNav = searchQuery.trim() ? currentFilteredCardIndex : currentCardIndex;
          if (cardIndexForNav > 0) {
            const prevCard = cardsToUseForNav[cardIndexForNav - 1];
            const prevOriginalIndex = cards.findIndex(c => c.id === prevCard.id);
            if (prevOriginalIndex >= 0) {
              handleCardClick(prevOriginalIndex);
            }
          }
          break;
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
  }, [currentCardIndex, cards.length, progress]);

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
        {/* Header Bar */}
        <div className="watch-header-bar">
          <div className="watch-header-left">
            <div className="watch-header-title-wrapper">
              <h1 
                className="watch-header-title"
                onClick={() => navigate(-1)}
              >
                <img 
                  src={rightAngleIcon} 
                  alt="" 
                  className="watch-header-title-icon"
                />
                {film?.title || 'Loading...'}
              </h1>
            </div>
            {!loadingProgress && progress && (
              <div className="watch-header-progress-bar-wrapper">
                <LearningProgressBar
                  totalCards={totalCards}
                  completedIndices={progress.completed_indices}
                  currentIndex={currentCardIndex}
                  onCardClick={handleCardClick}
                  className="watch-header-progress-bar"
                  filterIcon={filterIcon}
                  customIcon={customIcon}
                />
              </div>
            )}
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="watch-grid">
          {/* Left column - Media + Carousel */}
          <div className="watch-grid-col-2">
            {/* Level Badge Row */}
            {currentCard && (
              <div className="watch-card-level-badge-row">
                {currentCard.levels && currentCard.levels.length > 0 ? (
                  currentCard.levels.map(
                    (lvl: { framework: string; level: string; language?: string }, idx: number) => (
                      <span
                        key={idx}
                        className={`level-badge level-${(lvl.level || '').toLowerCase()}`}
                      >
                        {lvl.level}
                      </span>
                    ),
                  )
                ) : (
                  <span className="level-badge level-unknown">Unknown</span>
                )}
              </div>
            )}
            {/* Media Container */}
            <div className="watch-media-container">
              {currentCard ? (
                <div className="watch-media-main">
                  {/* Card Image */}
                  <div className="watch-media-image-wrapper">
                    {/* SRS State Dropdown - Top Left */}
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
                    {getCurrentCardImageUrl() ? (
                      <img
                        src={getCurrentCardImageUrl()}
                        alt={`Card ${searchQuery.trim() ? currentFilteredCardIndex + 1 : currentCardIndex + 1}`}
                        className="watch-media-image"
                      />
                    ) : (
                      <div className="watch-media-placeholder">
                        <p className="watch-media-placeholder-title">Card {searchQuery.trim() ? currentFilteredCardIndex + 1 : currentCardIndex + 1}</p>
                        <p className="watch-media-placeholder-subtitle">No image available</p>
                      </div>
                    )}
                  </div>

                  {/* Auto-play row under image */}
                  <div className="watch-media-controls">
                    <button
                      className={`watch-overlay-autoplay-btn ${isAutoPlaying ? 'active' : ''}`}
                      onClick={handleAutoPlayToggle}
                      title={isAutoPlaying ? "Stop auto-play" : "Start auto-play"}
                    >
                      <div className="watch-overlay-autoplay-icon-wrapper">
                        <img src={buttonPlayIcon} alt="Auto-play" className="watch-overlay-autoplay-icon" />
                      </div>
                      <span>Auto-play</span>
                    </button>
                    <span className="watch-overlay-card-number">
                      {searchQuery.trim() ? currentFilteredCardIndex + 1 : currentCardIndex + 1}/{searchQuery.trim() ? filteredCards.length : totalCards}
                    </span>

                    {/* Hidden audio element for auto-play */}
                    {getCurrentCardAudioUrl() && (
                      <audio
                        ref={audioRef}
                        onEnded={handleAutoPlayAudioEnd}
                        preload="auto"
                        style={{ display: 'none' }}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="watch-no-media">
                  <p className="text-white">No cards available for this episode</p>
                </div>
              )}
            </div>

            {/* Card Carousel - Thumbnails */}
            <div className="watch-card-carousel" ref={carouselRef}>
              {(searchQuery.trim() ? filteredCards : cards).map((card, index) => {
                const originalIndex = cards.findIndex(c => c.id === card.id);
                const isActive = searchQuery.trim() 
                  ? index === currentFilteredCardIndex 
                  : index === currentCardIndex;
                const isCompleted = originalIndex >= 0 && progress?.completed_indices.has(originalIndex) || false;
                const imageUrl = card.image_url ? 
                  (card.image_url.startsWith('/') && R2Base ? R2Base + card.image_url : card.image_url) : 
                  '';
                
                return (
                  <button
                    key={card.id}
                    data-card-index={originalIndex >= 0 ? originalIndex : index}
                    onClick={() => handleCardClick(originalIndex >= 0 ? originalIndex : index)}
                    className={`watch-card-thumbnail ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
                  >
                    <img
                      src={imageUrl || '/placeholder-image.jpg'}
                      alt={`Card ${index + 1}`}
                      className="watch-card-thumbnail-image"
                      onError={(e) => {
                        // Show placeholder instead of broken image
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const placeholder = target.nextElementSibling as HTMLElement;
                        if (placeholder && placeholder.classList.contains('watch-card-thumbnail-placeholder')) {
                          placeholder.style.display = 'flex';
                        }
                      }}
                    />
                    <div className="watch-card-thumbnail-placeholder" style={{ display: imageUrl ? 'none' : 'flex' }}>
                      <span className="text-xs">{index + 1}</span>
                    </div>
                  </button>
                );
              })}
              
              {/* Loading indicator when fetching more cards */}
              {loadingMoreCards && (
                <div className="watch-card-thumbnail-loading">
                  <div className="watch-loading-spinner"></div>
                  <span className="text-xs text-pink-200">Loading...</span>
                </div>
              )}
              
              {/* End of episode indicator */}
              {noMoreCards && (
                <div className="watch-card-thumbnail-end">
                  <span className="text-xs text-gray-400">End of episode</span>
                </div>
              )}
            </div>

          </div>

          {/* Right column - Subtitles panel */}
          <div className="watch-grid-col-1">
            <div className="watch-subtitles-panel">
              {/* Search header */}
              <div className="watch-subtitles-search">
                <button className="watch-subtitles-search-btn" type="button">
                  <img src={searchIcon} alt="Search" className="watch-subtitles-search-icon" />
                </button>
                <div className="watch-subtitles-search-divider"></div>
                <input
                  type="text"
                  placeholder="Search vocabulary..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="watch-subtitles-search-input"
                />
              </div>

              {/* Subtitle display area */}
              <div className="watch-subtitles-list">
                {(searchQuery.trim() ? filteredCards : cards).length > 0 ? (
                  (searchQuery.trim() ? filteredCards : cards).map((card, index) => {
                    const originalIndex = cards.findIndex(c => c.id === card.id);
                    const mainText = getSubtitleText(card, mainLanguage);
                    const isActive = searchQuery.trim()
                      ? index === currentFilteredCardIndex
                      : index === currentCardIndex;
                    const isCompleted = originalIndex >= 0 && progress?.completed_indices.has(originalIndex) || false;

                    // Languages user selected in SubtitleLanguageSelector (excluding main language)
                    const selectedSubtitleLangs = subtitleLanguages.filter(
                      (lang) => lang && lang !== mainLanguage
                    );

                    return (
                      <div
                        key={card.id}
                        id={`card-${originalIndex >= 0 ? originalIndex : index}`}
                        onClick={() => handleCardClick(originalIndex >= 0 ? originalIndex : index)}
                        className={`watch-subtitle-card ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
                        style={isActive ? { backgroundColor: 'var(--hover-bg)' } : undefined}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleCardClick(originalIndex >= 0 ? originalIndex : index);
                          }
                        }}
                      >
                        {/* Left section - subtitles (90%) */}
                        <div className="watch-subtitle-left">
                          <div className="watch-subtitle-card-header">
                            <div className="watch-subtitle-card-content">
                              {(() => {
                                const primaryCode = canonicalizeLangCode(mainLanguage) || mainLanguage;
                                const { html, isRuby } = buildSubtitleHtml(card, primaryCode, searchQuery.trim() || undefined);
                                const displayHtml = html || escapeHtml(mainText || '—');
                                
                                const name = codeToName(primaryCode);
                                const roleClass = `${name}-main`;
                                
                                return (
                                  <p
                                    className={`watch-subtitle-main-text ${roleClass} ${isRuby ? 'hanzi-ruby' : ''}`}
                                    dangerouslySetInnerHTML={{ __html: displayHtml }}
                                  />
                                );
                              })()}
                            </div>
                          </div>
                          {/* Show only translations user selected in SubtitleLanguageSelector */}
                          {selectedSubtitleLangs.map((lang) => {
                            const langText = getSubtitleText(card, lang);
                            if (!langText || langText === mainText) return null;
                            const { html, isRuby } = buildSubtitleHtml(card, lang, searchQuery.trim() || undefined);
                            const displayHtml = html || escapeHtml(langText);
                            
                            const name = codeToName(lang);
                            const roleClass = `${name}-sub`;
                            
                            return (
                              <p
                                key={lang}
                                className={`watch-subtitle-secondary-text ${roleClass} ${isRuby ? 'hanzi-ruby' : ''}`}
                                dangerouslySetInnerHTML={{ __html: displayHtml }}
                              />
                            );
                          })}
                        </div>

                        {/* Right section - action buttons (Save / More) */}
                        <div className="watch-subtitle-right">
                          <button
                            className={`watch-subtitle-action-btn ${cardSaveStates[card.id]?.saved ? 'saved' : ''}`}
                            onClick={(e) => handleToggleSaveCard(card, e)}
                            title={cardSaveStates[card.id]?.saved ? "Unsave card" : "Save card"}
                          >
                            <img src={saveHeartIcon} alt="Save" className="watch-subtitle-action-icon" />
                          </button>
                          <button
                            className="watch-subtitle-action-btn"
                            onClick={(e) => { e.stopPropagation(); }}
                            title="More options"
                          >
                            <img src={threeDotsIcon} alt="More" className="watch-subtitle-action-icon" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="watch-subtitles-empty">
                    <p>No subtitles available</p>
                  </div>
                )}
                
                {/* End of episode indicator */}
                {noMoreCards && cards.length > 0 && (
                  <div className="watch-subtitles-end">
                    <img src={enterMovieViewIcon} alt="End" className="watch-subtitles-end-icon" />
                    <p className="watch-subtitles-end-text">End of Episode</p>
                    <p className="watch-subtitles-end-subtext">
                      You've completed all {currentEpisode?.num_cards || cards.length} cards
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Tags Section */}
        <div className="watch-tags-section" ref={tagsDropdownRef}>
          <button 
            className="watch-tag-dropdown-btn"
            onClick={() => setTagsDropdownOpen(!tagsDropdownOpen)}
          >
            <span>Episode</span>
            <img 
              src={rightAngleIcon} 
              alt="Dropdown" 
              className={`watch-tag-dropdown-icon ${tagsDropdownOpen ? 'expanded' : 'collapsed'}`}
            />
          </button>
          
          {/* Category tags - inline with dropdown button */}
          {film?.main_language && (
            <span className="watch-tag-category">{langLabel(film.main_language)}</span>
          )}
          {film?.type && (
            <span className="watch-tag-category">
              {film.type.charAt(0).toUpperCase() + film.type.slice(1)}
            </span>
          )}
          {film?.title && film.title.toLowerCase().includes('ghibli') && (
            <span className="watch-tag-category">Ghibli</span>
          )}
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
                  
                  // Get dominant level from level_framework_stats (same logic as ContentSelector)
                  const getItemDominantLevel = (film: FilmDoc): string | null => {
                    const stats = parseLevelStats(film.level_framework_stats);
                    if (!stats || !Array.isArray(stats) || stats.length === 0) {
                      return null;
                    }
                    
                    let maxLevel: string | null = null;
                    let maxPercent = 0;
                    
                    for (const entry of stats) {
                      if (!entry.levels || typeof entry.levels !== 'object') continue;
                      
                      for (const [level, percent] of Object.entries(entry.levels)) {
                        if (typeof percent === 'number' && percent > maxPercent) {
                          maxPercent = percent;
                          maxLevel = level; // Don't uppercase - keep original case
                        }
                      }
                    }
                    
                    return maxLevel;
                  };
                  
                  const dominantLevel = getItemDominantLevel(item);
                  
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
