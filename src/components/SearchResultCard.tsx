import { useEffect, useMemo, useRef, useState, memo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { CardDoc } from "../types";
import { useUser } from "../context/UserContext";
import { canonicalizeLangCode } from "../utils/lang";
import toast from 'react-hot-toast';
import { subtitleText, normalizeCjkSpacing } from "../utils/subtitles";
import { getCardByPath, fetchCardsForFilm } from "../services/firestore";
import { apiToggleSaveCard, apiGetCardSaveStatus, apiUpdateCardSRSState, apiIncrementReviewCount } from "../services/cfApi";
import { apiIncrementListeningSession, apiTrackAttempt } from "../services/userTracking";
import { SELECTABLE_SRS_STATES, SRS_STATE_LABELS, type SRSState } from "../types/srsStates";
import "../styles/components/search-result-card.css";
import threeDotsIcon from "../assets/icons/three-dots.svg";
import buttonPlayIcon from "../assets/icons/button-play.svg";
import buttonPauseIcon from "../assets/icons/button-pause.svg";
import rightAngleIcon from "../assets/icons/right-angle.svg";
import headphoneIcon from "../assets/icons/headphone.svg";
import eyeIcon from "../assets/icons/eye.svg";
import warningIcon from "../assets/icons/icon-warning.svg";
import saveHeartIcon from "../assets/icons/save-heart.svg";
import starIcon from "../assets/icons/star.svg";
import starFillIcon from "../assets/icons/star-fill.svg";
import { getLevelBadgeColors } from "../utils/levelColors";
import diamondScoreIcon from "../assets/icons/diamond-score.svg";

// Global registry to ensure only one audio plays at a time across all cards
const activeAudioInstances = new Set<HTMLAudioElement>();

// Global cache for episode cards to prevent duplicate fetches
const episodeCardsCache = new Map<string, { cards: CardDoc[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

// Track pending requests to prevent duplicate fetches
const pendingEpisodeRequests = new Map<string, Promise<CardDoc[]>>();

interface Props {
  card: CardDoc;
  highlightQuery?: string; // optional search keyword to highlight in subtitles
  primaryLang?: string; // film's primary (audio) language to show first
  filmTitle?: string; // content title to display
  volume?: number; // audio volume (0-100)
  subtitleLanguages?: string[]; // selected subtitle languages for memo comparison
  onUnsave?: (cardId: string) => void; // callback when card is unsaved
  onSaveStatusChange?: (cardId: string, status: { saved: boolean; srs_state: string; review_count: number }) => void; // callback when save status changes
  onTrackReading?: (seconds: number) => void; // callback to track reading time
  onTrackListening?: (seconds: number) => void; // callback to track listening time
  initialSaveStatus?: { saved: boolean; srs_state: string; review_count: number }; // pre-loaded save status to avoid N+1 queries
  practiceMode?: "listening" | "reading" | "speaking" | "writing" | null;
  onToggleStar?: (filmId: string) => void; // callback when star button is clicked — parent handles API call + state update
  starredContentIds?: Set<string>; // set of starred film_ids for quick lookup
}

// Memoized component to prevent unnecessary re-renders
const SearchResultCard = memo(function SearchResultCard({
  card: initialCard,
  highlightQuery,
  primaryLang,
  filmTitle,
  volume = 28,
  subtitleLanguages,
  onUnsave,
  onSaveStatusChange,
  onTrackReading,
  onTrackListening,
  initialSaveStatus,
  practiceMode = null,
  onToggleStar,
  starredContentIds,
}: Props) {
  const { user, preferences } = useUser();
  const navigate = useNavigate();
  // Use prop if provided, otherwise fallback to preferences
  const langs = useMemo(() =>
    subtitleLanguages || preferences.subtitle_languages || [],
    [subtitleLanguages, preferences.subtitle_languages]
  );
  const ref = useRef<HTMLDivElement | null>(null);
  const [subsOverride, setSubsOverride] = useState<Record<string, string> | null>(null);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [episodeCards, setEpisodeCards] = useState<CardDoc[]>([]);
  const [currentCardIndex, setCurrentCardIndex] = useState<number>(-1);
  const [originalCardIndex, setOriginalCardIndex] = useState<number>(-1);
  const episodeCardsLoadedRef = useRef<boolean>(false);
  const episodeCardsDataRef = useRef<{ cards: CardDoc[]; currentIndex: number } | null>(null);
  const loadEpisodeResolveRef = useRef<(() => void) | null>(null);
  const shortcutHandlersRef = useRef<{
    handlePrevCard: () => void;
    handleNextCard: () => void;
    handleImageClick: () => void;
    handleReplayAudio: () => void;
    handleReturnToOriginal: () => void;
    handleMoveToPrevCardHover: () => void;
    handleMoveToNextCardHover: () => void;
    handleToggleSave: (e: React.MouseEvent) => void;
  } | null>(null);
  const [card, setCard] = useState<CardDoc>(initialCard);
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const [expandedSubtitles, setExpandedSubtitles] = useState<Set<string>>(new Set());
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [srsState, setSrsState] = useState<SRSState>('none');
  const [reviewCount, setReviewCount] = useState<number>(0);
  const [imageError, setImageError] = useState<boolean>(false);
  const [srsDropdownOpen, setSrsDropdownOpen] = useState<boolean>(false);
  const [isStarred, setIsStarred] = useState<boolean>(false);
  const srsDropdownRef = useRef<HTMLDivElement | null>(null);
  const hasIncrementedReview = useRef<boolean>(false);
  const incrementReviewTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasIncrementedListeningSession = useRef<boolean>(false);
  const isIncrementingListeningSession = useRef<boolean>(false);
  const pendingReviewIncrement = useRef<{ cardId: string; filmId?: string; episodeId?: string } | null>(null);
  const audioPlayHandlerRef = useRef<(() => void) | null>(null);
  
  // Reading time tracking
  const readingStartTimeRef = useRef<number | null>(null);
  const readingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Listening time tracking
  const listeningStartTimeRef = useRef<number | null>(null);
  const listeningIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Inline Listening practice state (Search page Practice dropdown)
  const [listeningAnswers, setListeningAnswers] = useState<Record<number, string>>({});
  const listeningInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const [listeningChecked, setListeningChecked] = useState<boolean>(false);
  const [listeningScore, setListeningScore] = useState<number | null>(null);
  const [listeningIncorrect, setListeningIncorrect] = useState<number[]>([]);
  const [listeningXp, setListeningXp] = useState<number | null>(null);
  const [isSubmittingListening, setIsSubmittingListening] = useState<boolean>(false);

  // Speaking practice state
  const [speakingTranscript, setSpeakingTranscript] = useState<string>('');
  const [speakingScore, setSpeakingScore] = useState<number | null>(null);
  const [speakingXp, setSpeakingXp] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [speakingChecked, setSpeakingChecked] = useState<boolean>(false);
  const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null);
  const [isPlayingRecording, setIsPlayingRecording] = useState(false);
  const audioPlaybackRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Reading practice state
  const [readingRevealed, setReadingRevealed] = useState<boolean>(false);
  const [readingXp, setReadingXp] = useState<number | null>(null);

  // Writing practice state (drag-and-drop word ordering)
  const [writingWords, setWritingWords] = useState<string[]>([]);
  const [writingChecked, setWritingChecked] = useState<boolean>(false);
  const [writingScore, setWritingScore] = useState<number | null>(null);
  const [writingXp, setWritingXp] = useState<number | null>(null);
  const writingDragIndex = useRef<number | null>(null);


  // Resolve image URL - API already returns full URL from image_key/audio_key
  const resolvedImageUrl = useMemo(() => {
    if (imageError) return '';
    return card.image_url || '';
  // card.image_url intentionally in deps (not card object) to avoid loop
  }, [card.image_url, imageError]);

  // Preload image to prevent jitter during card navigation
  const preloadImage = useCallback((url: string) => {
    return new Promise<void>((resolve) => {
      if (!url) { resolve(); return; }
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = url;
      // Fallback: resolve after 200ms even if image hasn't loaded
      setTimeout(resolve, 200);
    });
  }, []);

  // Preload adjacent cards' images for smooth transitions (eager loading)
  const preloadAdjacentCards = useCallback(async () => {
    if (episodeCards.length === 0) return;
    const idx = currentCardIndex;
    // Preload prev-1, prev-2, next-1, next-2 cards
    const offsets = [-2, -1, 1, 2];
    const preloadPromises = offsets.map(offset => {
      const targetIdx = idx + offset;
      if (targetIdx >= 0 && targetIdx < episodeCards.length) {
        const c = episodeCards[targetIdx];
        if (c.image_url) return preloadImage(c.image_url);
      }
      return null;
    }).filter(Boolean);
    // Don't await - preload in background
    Promise.all(preloadPromises).catch(() => {/* ignore errors */});
  }, [episodeCards, currentCardIndex, preloadImage]);

  // Trigger adjacent card preloading when card changes
  useEffect(() => {
    preloadAdjacentCards();
  }, [card.id, preloadAdjacentCards]);

  // Update card when initialCard changes
  useEffect(() => {
    setCard((prev) => ({
      ...initialCard,
      levels: initialCard.levels || prev.levels,
      level_frequency_ranks: initialCard.level_frequency_ranks ?? prev.level_frequency_ranks ?? null,
    }));
    // Reset to original when initialCard changes (new search result)
    setOriginalCardIndex(-1);
    // Reset image error state so new card's image can load properly
    setImageError(false);
    // Don't clear subtitle override immediately - let the subtitle fetch useEffect handle it
    // This ensures smooth transition when subtitle languages change
  }, [initialCard.id, initialCard.image_url, initialCard.subtitle, initialCard.level_frequency_ranks, initialCard.levels]);

  // Initialize save status from prop if provided (optimized batch loading)
  useEffect(() => {
    if (initialSaveStatus !== undefined && initialSaveStatus !== null) {
      setIsSaved(initialSaveStatus.saved);
      setSrsState(initialSaveStatus.srs_state as SRSState);
      setReviewCount(initialSaveStatus.review_count);
      return;
    }
    
    // Fallback: Load saved status, SRS state, and review count for card (only if not provided)
    if (!user?.uid || !card.id) {
      setIsSaved(false);
      setSrsState('none');
      setReviewCount(0);
      return;
    }
    
    let mounted = true;
    (async () => {
      try {
        const status = await apiGetCardSaveStatus(
          user.uid, 
          card.id,
          card.film_id,
          card.episode_id || (typeof card.episode === 'number' ? `e${card.episode}` : String(card.episode || ''))
        );
        if (mounted) {
          setIsSaved(status.saved);
          setSrsState(status.srs_state as SRSState);
          setReviewCount(status.review_count);
        }
      } catch (error) {
        console.error('Failed to load card save status:', error);
        if (mounted) {
          setIsSaved(false);
          setSrsState('none');
          setReviewCount(0);
        }
      }
    })();
    
    return () => { mounted = false; };
  }, [user?.uid, card.id, card.film_id, card.episode_id, card.episode, initialSaveStatus]);

  // Initialize starred state from starredContentIds prop
  useEffect(() => {
    if (starredContentIds && card.film_id) {
      setIsStarred(starredContentIds.has(card.film_id));
    } else {
      setIsStarred(false);
    }
  }, [starredContentIds, card.film_id]);

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

  // Handle save/unsave card
  const handleToggleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user?.uid || !card.id) {
      toast.error('Please sign in to save cards.');
      return;
    }
    
    try {
      const result = await apiToggleSaveCard(
        user.uid,
        card.id,
        card.film_id,
        card.episode_id || (typeof card.episode === 'number' ? `e${card.episode}` : String(card.episode || ''))
      );
      setIsSaved(result.saved);
      const newSrsState = result.saved ? 'new' : 'none';
      if (result.saved) {
        setSrsState('new'); // Default to 'new' when saving
      } else {
        setSrsState('none');
        setSrsDropdownOpen(false);
        // Call onUnsave callback if provided (e.g., from SavedCardsPage)
        if (onUnsave) {
          onUnsave(card.id);
        }
      }
      // Notify parent so cardSaveStatuses stays in sync
      if (onSaveStatusChange) {
        onSaveStatusChange(card.id, { saved: result.saved, srs_state: newSrsState, review_count: reviewCount });
      }
    } catch (error) {
      console.error('Failed to toggle save card:', error);
    }
  };

  // Handle SRS state change
  const handleSRSStateChange = async (newState: SRSState) => {
    if (!user?.uid || !card.id) return;
    
    try {
      await apiUpdateCardSRSState(
        user.uid, 
        card.id, 
        newState,
        card.film_id,
        card.episode_id || (typeof card.episode === 'number' ? `e${card.episode}` : String(card.episode || ''))
      );
      setSrsState(newState);
      setSrsDropdownOpen(false);
      // Notify parent of SRS state change
      if (onSaveStatusChange) {
        onSaveStatusChange(card.id, { saved: newState !== 'none', srs_state: newState, review_count: reviewCount });
      }
    } catch (error) {
      console.error('Failed to update SRS state:', error);
    }
  };

  // Helper function to increment review count with debounce
  const incrementReviewCountForCard = useCallback(async (targetCard: CardDoc) => {
    if (!user?.uid || !targetCard.id) return;
    
    // Clear any pending increment
    if (incrementReviewTimeoutRef.current) {
      clearTimeout(incrementReviewTimeoutRef.current);
      incrementReviewTimeoutRef.current = null;
    }
    
    // Store pending increment info
    pendingReviewIncrement.current = {
      cardId: targetCard.id,
      filmId: targetCard.film_id,
      episodeId: targetCard.episode_id || (typeof targetCard.episode === 'number' ? `e${targetCard.episode}` : String(targetCard.episode || ''))
    };
    
    // Debounce: wait 300ms before actually calling API
    // This batches rapid increments (e.g., quick A/D navigation)
    incrementReviewTimeoutRef.current = setTimeout(async () => {
      if (!pendingReviewIncrement.current) return;
      
      const { cardId, filmId, episodeId } = pendingReviewIncrement.current;
      pendingReviewIncrement.current = null;
      
      try {
        const result = await apiIncrementReviewCount(
          user.uid,
          cardId,
          filmId,
          episodeId
        );
        
        // Only update if this is the current card
        if (cardId === card.id) {
          setReviewCount(result.review_count);
        }
      } catch (error) {
        console.error('Failed to increment review count:', error);
      }
    }, 300);
  }, [user?.uid, card.id]);

  // Handle increment review count on hover
  const handleMouseEnter = () => {
    setIsHovered(true);

    // Start tracking reading time
    if (onTrackReading) {
      readingStartTimeRef.current = Date.now();
      // Track reading time every 8 seconds (as per requirements)
      readingIntervalRef.current = setInterval(() => {
        if (readingStartTimeRef.current) {
          const elapsed = (Date.now() - readingStartTimeRef.current) / 1000;
          if (elapsed >= 8) {
            onTrackReading(8);
            readingStartTimeRef.current = Date.now(); // Reset for next interval
          }
        }
      }, 8000);
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    // Reset flag so we can increment again when hovering back
    hasIncrementedReview.current = false;
    
    // Stop tracking reading time and report final time
    if (onTrackReading && readingStartTimeRef.current) {
      const elapsed = Math.floor((Date.now() - readingStartTimeRef.current) / 1000);
      if (elapsed > 0) {
        // Only track if at least 1 second has passed
        onTrackReading(elapsed);
      }
      readingStartTimeRef.current = null;
    }
    if (readingIntervalRef.current) {
      clearInterval(readingIntervalRef.current);
      readingIntervalRef.current = null;
    }
  };

  // Reset review increment flag and listening session flag when card changes
  useEffect(() => {
    hasIncrementedReview.current = false;
    hasIncrementedListeningSession.current = false;
    // Clear any pending increment for previous card
    if (incrementReviewTimeoutRef.current) {
      clearTimeout(incrementReviewTimeoutRef.current);
      incrementReviewTimeoutRef.current = null;
    }
    pendingReviewIncrement.current = null;
  }, [card.id]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (incrementReviewTimeoutRef.current) {
        clearTimeout(incrementReviewTimeoutRef.current);
      }
      if (readingIntervalRef.current) {
        clearInterval(readingIntervalRef.current);
      }
      if (listeningIntervalRef.current) {
        clearInterval(listeningIntervalRef.current);
      }
      // Report final reading time if still tracking
      if (onTrackReading && readingStartTimeRef.current) {
        const elapsed = Math.floor((Date.now() - readingStartTimeRef.current) / 1000);
        if (elapsed > 0) {
          onTrackReading(elapsed);
        }
      }
      // Report final listening time if still tracking
      if (onTrackListening && listeningStartTimeRef.current) {
        const elapsed = Math.floor((Date.now() - listeningStartTimeRef.current) / 1000);
        if (elapsed > 0) {
          onTrackListening(elapsed);
        }
      }
    };
  }, [onTrackReading, onTrackListening]);

  // Setup event listener for audio play to track listening sessions
  // This function is called whenever audio element is created or reused
  const setupAudioPlayListener = useCallback((audio: HTMLAudioElement) => {
    // Track listening session when audio starts playing
    const handlePlay = () => {
      // Only increment once per play session (reset when audio ends)
      if (!hasIncrementedListeningSession.current && !isIncrementingListeningSession.current && user?.uid) {
        hasIncrementedListeningSession.current = true;
        isIncrementingListeningSession.current = true;
        
        // Increment listening session count (fire and forget, don't block audio play)
        apiIncrementListeningSession()
          .then(() => {
            isIncrementingListeningSession.current = false;
          })
          .catch(err => {
            console.warn('Failed to increment listening session:', err);
            isIncrementingListeningSession.current = false;
          });
      }
    };
    
    audio.addEventListener('play', handlePlay);

    // Store handler for cleanup
    audioPlayHandlerRef.current = handlePlay;
  }, [user?.uid]);

  // Cleanup audio play listener
  const cleanupAudioPlayListener = useCallback((audio: HTMLAudioElement | null) => {
    if (audio && audioPlayHandlerRef.current) {
      audio.removeEventListener('play', audioPlayHandlerRef.current);
      audioPlayHandlerRef.current = null;
    }
  }, []);

  // Sync volume from props (0-100) to audio element (0-1)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const normalizedVolume = Math.max(0, Math.min(100, volume)) / 100;
    // Set volume directly - HTMLAudioElement.volume can be changed while playing
    audio.volume = normalizedVolume;
  }, [volume]);

  // Create stable keys for dependency tracking
  const subtitleKeys = useMemo(() => {
    const keys = card.subtitle ? Object.keys(card.subtitle).sort().join(',') : '';
    const overrideKeys = subsOverride ? Object.keys(subsOverride).sort().join(',') : '';
    return `${keys}|${overrideKeys}`;
  }, [card.subtitle, subsOverride]);

  const shownLangs = useMemo(() => {
    const effectiveCard = subsOverride ? { ...card, subtitle: { ...(card.subtitle || {}), ...subsOverride } } : card;
    const ORDER = [
      "en",
      "vi",
      "zh",
      "zh_trad",
      "yue", // Cantonese after Traditional Chinese
      "ja",
      "ko",
      "id",
      "th",
      "ms",
    ] as const;
    const orderIndex = (code: string) => {
      const idx = ORDER.indexOf(
        (canonicalizeLangCode(code) ||
          code) as unknown as (typeof ORDER)[number]
      );
      return idx === -1 ? 999 : idx;
    };
    // Determine which codes to show:
    // - Always show the film's primary language first (when provided)
    // - Then show user's selected secondary subtitle languages, ordered by our stable ORDER
    const primary = primaryLang
      ? (canonicalizeLangCode(primaryLang) || primaryLang)
      : undefined;
    // Build secondary list from user's subtitle preferences
    const secondaryAll = (
      langs && langs.length ? langs : []
    ).map((c) => canonicalizeLangCode(c) || (c as string));
    const uniqSecondary = Array.from(new Set(secondaryAll as string[]));
    const filteredSecondary = uniqSecondary.filter(
      (c) => !primary || c !== primary
    );
    const sortedSecondary = filteredSecondary.sort(
      (a, b) => orderIndex(a) - orderIndex(b)
    );
    // Always include primary (film's audio language) first, then selected subtitle languages
    const finalOrder = (primary ? [primary] : []).concat(sortedSecondary);
    // If no subtitle languages selected (langs is empty), only show primary language (without subtitle)
    // If subtitle languages selected, show those that have subtitle data
    if (langs.length === 0) {
      // No subtitle languages selected - don't show any subtitles, only primary for sentence/audio
      return primary ? [primary] : [];
    }
    // Keep primary ALWAYS (will fallback to sentence if no subtitle), secondaries only if subtitle exists
    return finalOrder.filter((code) => {
      if (primary && code === primary) return true; // always show primary
      return !!subtitleText(effectiveCard, code); // secondary needs subtitle
    });
  }, [card.id, subtitleKeys, langs, primaryLang]);

  // Base text for inline Listening practice (primary language subtitle or sentence)
  interface ListeningClozeConfig {
    raw: string;
    tokens: string[];
    blankTokenIndexes: number[];
    expectedNormalized: string[];
  }

  const normalizeListeningWord = (text: string): string => {
    if (!text) return "";
    let normalized = text.replace(/\[[^\]]+\]/g, "");
    normalized = normalized.replace(/[、。．・，,。！!？?：:；;「」『』（）()［］[\]…—-]/g, "");
    normalized = normalized.replace(/[\p{P}\p{S}]/gu, "");
    normalized = normalized.trim().replace(/\s+/g, " ").toLowerCase();
    return normalized;
  };

  const listeningClozeConfig: ListeningClozeConfig | null = useMemo(() => {
    if (practiceMode !== "listening") return null;

    const effectiveCard = subsOverride
      ? { ...card, subtitle: { ...(card.subtitle || {}), ...subsOverride } }
      : card;

    const primaryCode = primaryLang
      ? canonicalizeLangCode(primaryLang) || primaryLang
      : undefined;

    if (!primaryCode) return null;

    let raw = effectiveCard.card_type ?? "";
    if (!raw) {
      raw = subtitleText(effectiveCard, primaryCode) ?? "";
    }
    if (!raw) {
      raw = effectiveCard.sentence ?? "";
    }
    if (!raw) return null;

    const tokens = raw.split(/\s+/).filter((w) => w.length > 0);
    if (tokens.length === 0) return null;

    const blankTokenIndexes: number[] = [];
    for (let i = 0; i < tokens.length && blankTokenIndexes.length < 5; i++) {
      const word = tokens[i];
      if (!/\p{L}/u.test(word)) continue;
      if (blankTokenIndexes.length === 0 || i % 3 === 1) {
        blankTokenIndexes.push(i);
      }
    }

    if (blankTokenIndexes.length === 0) return null;

    const expectedNormalized = blankTokenIndexes.map((idx) =>
      normalizeListeningWord(tokens[idx])
    );

    return { raw, tokens, blankTokenIndexes, expectedNormalized };
  }, [card, subsOverride, primaryLang, practiceMode, subtitleKeys]);

  // Writing practice config: all tokens from primary subtitle, shuffled
  const writingConfig = useMemo(() => {
    if (practiceMode !== "writing") return null;
    const effectiveCard = subsOverride ? { ...card, subtitle: { ...(card.subtitle || {}), ...subsOverride } } : card;
    const primaryCode = primaryLang ? canonicalizeLangCode(primaryLang) || primaryLang : undefined;
    if (!primaryCode) return null;
    let raw = effectiveCard.card_type ?? "";
    if (!raw) raw = subtitleText(effectiveCard, primaryCode) ?? "";
    if (!raw) raw = effectiveCard.sentence ?? "";
    if (!raw) return null;
    const tokens = raw.split(/\s+/).filter(w => w.length > 0);
    if (tokens.length < 2) return null;
    // Fisher-Yates shuffle (seeded by card.id for consistency within a session)
    const shuffled = [...tokens];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return { tokens, shuffled };
  }, [card, subsOverride, primaryLang, practiceMode, subtitleKeys]);

  // Initialize writingWords when writingConfig is ready
  useEffect(() => {
    if (writingConfig) {
      setWritingWords([...writingConfig.shuffled]);
    }
  }, [writingConfig]);

  // Reset inline Listening practice state when card or mode changes
  useEffect(() => {
    setListeningAnswers({});
    setListeningChecked(false);
    setListeningScore(null);
    setListeningIncorrect([]);
    setListeningXp(null);
    setIsSubmittingListening(false);
  }, [card.id, practiceMode, listeningClozeConfig]);

  // Reset speaking, reading, writing practice state when card or mode changes
  useEffect(() => {
    setSpeakingTranscript('');
    setSpeakingScore(null);
    setSpeakingXp(null);
    setIsRecording(false);
    setSpeakingChecked(false);
    setReadingRevealed(false);
    setReadingXp(null);
    // writingWords is reset by the writingConfig init effect below
    setWritingChecked(false);
    setWritingScore(null);
    setWritingXp(null);
  }, [card.id, practiceMode]);

  const handleListeningAgain = () => {
    setListeningAnswers({});
    setListeningChecked(false);
    setListeningScore(null);
    setListeningIncorrect([]);
    setListeningXp(null);
  };

  const handleListeningCheck = async () => {
    if (!listeningClozeConfig) return;
    if (listeningChecked) return;

    const { expectedNormalized } = listeningClozeConfig;
    const userNormalized = expectedNormalized.map((_, idx) =>
      normalizeListeningWord(listeningAnswers[idx] || "")
    );

    let correctCount = 0;
    const incorrectIdxs: number[] = [];

    expectedNormalized.forEach((expected, idx) => {
      if (userNormalized[idx] && userNormalized[idx] === expected) {
        correctCount++;
      } else {
        incorrectIdxs.push(idx);
      }
    });

    const total = expectedNormalized.length || 1;
    const score = Math.round((correctCount / total) * 10000) / 100;
    setListeningScore(score);
    setListeningIncorrect(incorrectIdxs);
    setListeningChecked(true);

    if (user?.uid && !isSubmittingListening) {
      try {
        setIsSubmittingListening(true);
        const res = await apiTrackAttempt(
          user.uid,
          "listening",
          card.id,
          card.film_id
        );
        if (typeof res?.xp_awarded === "number") {
          setListeningXp(res.xp_awarded);
          if (res.xp_awarded > 0) {
            window.dispatchEvent(new CustomEvent('xp-awarded', { detail: { xp: res.xp_awarded } }));
          }
        }
      } catch (error) {
        console.error("Failed to track listening attempt:", error);
      } finally {
        setIsSubmittingListening(false);
      }
    }
  };

  // BCP-47 language code mapping for Web Speech API
  const langToBCP47: Record<string, string> = {
    ja: 'ja-JP', en: 'en-US', vi: 'vi-VN',
    zh: 'zh-CN', zh_trad: 'zh-TW', ko: 'ko-KR',
    fr: 'fr-FR', de: 'de-DE', es: 'es-ES',
    it: 'it-IT', pt: 'pt-PT', ru: 'ru-RU',
    ar: 'ar-SA', th: 'th-TH', id: 'id-ID',
  };

  const handleSpeakStart = () => {
    type SpeechRecognitionCtor = new () => {
      lang: string;
      interimResults: boolean;
      maxAlternatives: number;
      onresult: ((event: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
      start: () => void;
    };
    const SpeechRecognition: SpeechRecognitionCtor | undefined =
      (window as Window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ||
      (window as Window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }

    const primaryCode = primaryLang ? (canonicalizeLangCode(primaryLang) || primaryLang) : 'en';
    const bcp47 = langToBCP47[primaryCode] || `${primaryCode}-${primaryCode.toUpperCase()}`;

    const recognition = new SpeechRecognition();
    recognition.lang = bcp47;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    setIsRecording(true);

    // Start audio recording
    const startRecording = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorderRef.current = new MediaRecorder(stream);
        const chunks: Blob[] = [];
        mediaRecorderRef.current.ondataavailable = (e) => chunks.push(e.data);
        mediaRecorderRef.current.onstop = () => {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const url = URL.createObjectURL(blob);
          setRecordedBlobUrl(url);
          stream.getTracks().forEach(t => t.stop());
        };
        mediaRecorderRef.current.start();
      } catch (err) {
        console.warn('Audio recording not supported:', err);
      }
    };
    startRecording();

    recognition.onresult = async (event) => {
      const transcript = event.results[0][0].transcript;
      setSpeakingTranscript(transcript);
      setIsRecording(false);
      setSpeakingChecked(true);

      // Score: compare transcript words against card_type (cleaned), subtitle, or sentence
      const effectiveCard = subsOverride ? { ...card, subtitle: { ...(card.subtitle || {}), ...subsOverride } } : card;
      const reference = effectiveCard.card_type || subtitleText(effectiveCard, primaryCode) || effectiveCard.sentence || '';
      const refWords = reference.toLowerCase().replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean);
      const spokenWords = transcript.toLowerCase().replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean);
      let correct = 0;
      refWords.forEach(w => { if (spokenWords.includes(w)) correct++; });
      const score = refWords.length > 0 ? Math.round((correct / refWords.length) * 10000) / 100 : 0;
      setSpeakingScore(score);

      // Award XP
      if (user?.uid) {
        try {
          const res = await apiTrackAttempt(user.uid, 'speaking', card.id, card.film_id);
          if (typeof res?.xp_awarded === 'number') {
            setSpeakingXp(res.xp_awarded);
            if (res.xp_awarded > 0) {
              window.dispatchEvent(new CustomEvent('xp-awarded', { detail: { xp: res.xp_awarded } }));
            }
          }
        } catch (error) {
          console.error('Failed to track speaking attempt:', error);
        }
      }

      // Stop audio recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };

    recognition.onerror = () => {
      setIsRecording(false);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };

    recognition.onend = () => {
      setIsRecording(false);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };

    recognition.start();
  };

  const handleSpeakAgain = () => {
    setSpeakingTranscript('');
    setSpeakingScore(null);
    setSpeakingXp(null);
    setSpeakingChecked(false);
    // Cleanup recording
    if (recordedBlobUrl) {
      URL.revokeObjectURL(recordedBlobUrl);
      setRecordedBlobUrl(null);
    }
    setIsPlayingRecording(false);
    if (audioPlaybackRef.current) {
      audioPlaybackRef.current.pause();
      audioPlaybackRef.current = null;
    }
  };

  const handleReadingShow = async () => {
    setReadingRevealed(true);
    if (user?.uid) {
      try {
        const res = await apiTrackAttempt(user.uid, 'reading', card.id, card.film_id);
        if (typeof res?.xp_awarded === 'number') {
          setReadingXp(res.xp_awarded);
          if (res.xp_awarded > 0) {
            window.dispatchEvent(new CustomEvent('xp-awarded', { detail: { xp: res.xp_awarded } }));
          }
        }
      } catch (error) {
        console.error('Failed to track reading attempt:', error);
      }
    }
  };

  // Writing practice handlers
  const handleWritingDragStart = (index: number) => {
    writingDragIndex.current = index;
  };

  const handleWritingDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (writingDragIndex.current === null || writingDragIndex.current === index) return;
    const newWords = [...writingWords];
    const draggedWord = newWords[writingDragIndex.current];
    newWords.splice(writingDragIndex.current, 1);
    newWords.splice(index, 0, draggedWord);
    setWritingWords(newWords);
    writingDragIndex.current = index;
  };

  const handleWritingDragEnd = () => {
    writingDragIndex.current = null;
  };

  const handleWritingCheck = async () => {
    if (!writingConfig) return;
    setWritingChecked(true);
    const correct = writingConfig.tokens;
    const userOrder = writingWords;
    let matchCount = 0;
    correct.forEach((w, i) => { if (userOrder[i] === w) matchCount++; });
    const score = Math.round((matchCount / correct.length) * 10000) / 100;
    setWritingScore(score);
    if (user?.uid) {
      try {
        const res = await apiTrackAttempt(user.uid, 'writing', card.id, card.film_id);
        if (typeof res?.xp_awarded === 'number') {
          setWritingXp(res.xp_awarded);
          if (res.xp_awarded > 0) {
            window.dispatchEvent(new CustomEvent('xp-awarded', { detail: { xp: res.xp_awarded } }));
          }
        }
      } catch (error) {
        console.error('Failed to track writing attempt:', error);
      }
    }
  };

  const handleWritingAgain = () => {
    if (writingConfig) {
      // Re-shuffle
      const shuffled = [...writingConfig.shuffled];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      setWritingWords(shuffled);
    }
    setWritingChecked(false);
    setWritingScore(null);
    setWritingXp(null);
  };

  // Fetch subtitle data when subtitle languages change or when subtitles are missing
  // This ensures subtitles are always available when user selects new languages
  useEffect(() => {
    const film = card.film_id;
    const epSlug = card.episode_id || (typeof card.episode === "number" ? `e${card.episode}` : String(card.episode || ""));
    const cid = String(card.id || "");

    if (!film || !epSlug || !cid) {
      setSubsOverride(null);
      return;
    }

    const selectedLangs = langs || [];

    // IMPORTANT: When no subtitle languages selected, clear override immediately
    // This ensures cards show only primary language when all subtitles are deselected
    if (selectedLangs.length === 0) {
      setSubsOverride(null);
      return;
    }

    // Always check if we need to fetch subtitles when langs change
    // This ensures that when user selects new subtitle languages, we fetch them immediately
    const hasSubs = card.subtitle && Object.keys(card.subtitle).length > 0;

    // Check if ANY selected language is missing from card.subtitle
    const missingLangs = selectedLangs.filter(lang => {
      const canonLang = canonicalizeLangCode(lang) || lang;
      return !card.subtitle || !(card.subtitle[canonLang] || card.subtitle[lang]);
    });

    // If card has no subtitles at all, or if ANY selected language is missing, fetch
    // This ensures we always have ALL selected subtitle languages
    const needsFetch = !hasSubs || missingLangs.length > 0;

    if (!needsFetch) {
      // All required subtitles are already present, clear override to use card.subtitle
      setSubsOverride(null);
      return;
    }

    // Fetch subtitle data to get ALL missing languages
    // This ensures we have complete subtitle data for all selected languages
    let active = true;
    (async () => {
      try {
        const detail = await getCardByPath(film, epSlug, cid);
        if (active && detail?.subtitle && Object.keys(detail.subtitle).length) {
          // Merge with existing subtitle data to preserve any data we already have
          // This ensures we have all subtitles including ALL newly selected languages
          const merged = {
            ...(card.subtitle || {}),
            ...detail.subtitle
          };
          setSubsOverride(merged);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      active = false;
    };
  }, [card.film_id, card.episode_id, card.episode, card.id, card.subtitle, langs]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuOpen]);

  // Simple HTML escaper
  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Convert bracket furigana/pinyin/jyutping to safe HTML.
  // For Japanese tokens: attempt to split trailing okurigana (kana after Kanji) so reading centers over Kanji only.
  function bracketToRubyHtml(text: string, lang?: string): string {
    if (!text) return "";
    const re = /([^\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000[]+)\s*\[([^\]]+)\]/g;
    let last = 0;
    let out = "";
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out += escapeHtml(text.slice(last, m.index));
      const base = m[1];
      const reading = m[2];
      // removed debug logging
      const hasKanji = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(base);
      const readingIsKanaOnly = /^[\u3040-\u309F\u30A0-\u30FFー]+$/.test(reading);
      if (lang === 'ja' && hasKanji && readingIsKanaOnly) {
        // Pattern: optional leading kana, kanji block, optional trailing kana (simple token)
        const simplePattern = /^([\u3040-\u309F\u30A0-\u30FFー]+)?([\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+)([\u3040-\u309F\u30A0-\u30FFー]+)?$/;
        const sp = base.match(simplePattern);
        if (sp) {
          const prefixKana = sp[1] || '';
          const kanjiPart = sp[2];
          const trailingKana = sp[3] || '';
          let readingCore = reading;
            // If reading ends with trailing kana, trim it for annotation width
          if (trailingKana && readingCore.endsWith(trailingKana)) {
            readingCore = readingCore.slice(0, readingCore.length - trailingKana.length);
          }
          // Do NOT trim prefix; prefix kana often grammatical and absent from reading
          if (prefixKana) out += escapeHtml(prefixKana); // plain text before ruby
          out += `<ruby><rb>${escapeHtml(kanjiPart)}</rb><rt>${escapeHtml(readingCore)}</rt></ruby>`;
          if (trailingKana) out += `<span class="okurigana">${escapeHtml(trailingKana)}</span>`;
        } else {
          // Complex mixed token (punctuation / Latin / multiple kanji groups). Try heuristic: annotate last Kanji cluster near end.
          const lastCluster = base.match(/([\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+[\u3040-\u309F\u30A0-\u30FFー]*)$/);
          if (lastCluster && reading.length <= lastCluster[0].length * 2) {
            const cluster = lastCluster[0];
            const before = base.slice(0, base.length - cluster.length);
            // Split cluster into kanji + trailing kana if applicable
            const clusterMatch = cluster.match(/^([\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+)([\u3040-\u309F\u30A0-\u30FFー]+)?$/);
            if (clusterMatch) {
              const clusterKanji = clusterMatch[1];
              const clusterOkurigana = clusterMatch[2] || '';
              let readingCore = reading;
              if (clusterOkurigana && readingCore.endsWith(clusterOkurigana)) {
                readingCore = readingCore.slice(0, readingCore.length - clusterOkurigana.length);
              }
              out += escapeHtml(before);
              out += `<ruby><rb>${escapeHtml(clusterKanji)}</rb><rt>${escapeHtml(readingCore)}</rt></ruby>`;
              if (clusterOkurigana) out += `<span class="okurigana">${escapeHtml(clusterOkurigana)}</span>`;
            } else {
              // Fallback: annotate whole base
              out += `<ruby><rb>${escapeHtml(base)}</rb><rt>${escapeHtml(reading)}</rt></ruby>`;
            }
          } else {
            // Fallback simple
            out += `<ruby><rb>${escapeHtml(base)}</rb><rt>${escapeHtml(reading)}</rt></ruby>`;
          }
        }
      } else {
        out += `<ruby><rb>${escapeHtml(base)}</rb><rt>${escapeHtml(reading)}</rt></ruby>`;
      }
      last = m.index + m[0].length;
    }
    out += escapeHtml(text.slice(last));
    const CJK_RANGE = "\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u3040-\\u30FF";
    out = out
      .replace(/^\s+/, "").replace(/\s+$/, "")
      .replace(/<\/ruby>\s+<ruby>/g, "</ruby><ruby>")
      .replace(new RegExp(`([${CJK_RANGE}])\\s+<ruby>`, "g"), "$1<ruby>")
      .replace(new RegExp(`<\\/ruby>\\s+([${CJK_RANGE}])`, "g"), "</ruby>$1")
      .replace(/\s+([、。．・，。！!？?：:；;」』）］])/g, "$1")
      .replace(/([「『（［])\s+/g, "$1");
    return out;
  }

  // Normalize Japanese text for comparison: Katakana → Hiragana, remove whitespace, remove furigana brackets
  function normalizeJapanese(text: string): string {
    try {
      // First remove HTML tags if present
      const withoutTags = text.replace(/<[^>]+>/g, '');
      // NFKC normalization for width, remove all whitespace, remove furigana brackets
      const nfkc = withoutTags.normalize('NFKC').replace(/\s+/g, '').replace(/\[[^\]]+\]/g, '');
      // Convert Katakana to Hiragana
      return nfkc.replace(/[\u30A1-\u30F6]/g, (ch) => 
        String.fromCharCode(ch.charCodeAt(0) - 0x60)
      );
    } catch {
      // Fallback: just Katakana → Hiragana, remove whitespace, tags and brackets
      return text.replace(/<[^>]+>/g, '').replace(/\s+/g, '').replace(/\[[^\]]+\]/g, '').replace(/[\u30A1-\u30F6]/g, (ch) => 
        String.fromCharCode(ch.charCodeAt(0) - 0x60)
      );
    }
  }

  // Check if text contains Japanese characters
  function hasJapanese(text: string): boolean {
    return /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(text);
  }

  // Helper to normalize a single character (Katakana → Hiragana, NFKC)
  function normChar(ch: string): string {
    try {
      const nfkc = ch.normalize('NFKC');
      // Katakana → Hiragana conversion
      return nfkc.replace(/[\u30A1-\u30F6]/g, (c) => 
        String.fromCharCode(c.charCodeAt(0) - 0x60)
      );
    } catch {
      return ch.replace(/[\u30A1-\u30F6]/g, (c) => 
        String.fromCharCode(c.charCodeAt(0) - 0x60)
      );
    }
  }

  // Highlight query occurrences with a styled span; case-insensitive
  function highlightHtml(text: string, q: string): string {
    if (!q) return escapeHtml(text);
    try {
      // For Japanese text, use normalized comparison (ignore whitespace)
      if (hasJapanese(q) || hasJapanese(text)) {
        const qNorm = normalizeJapanese(q.trim());
        
        // Build normalized version of text, tracking position mapping
        const posMap: number[] = []; // posMap[i] = original position for normalized position i
        let normalized = '';
        
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          // Skip whitespace and brackets
          if (/\s/.test(ch) || ch === '[' || ch === ']') {
            continue;
          }
          // Inside bracket (furigana) - skip content
          if (i > 0 && text.lastIndexOf('[', i) > text.lastIndexOf(']', i)) {
            continue;
          }
          
          const norm = normChar(ch);
          for (let j = 0; j < norm.length; j++) {
            normalized += norm[j];
            posMap.push(i);
          }
        }
        
        // Find match in normalized text
        const matchIdx = normalized.indexOf(qNorm);
        if (matchIdx === -1) return escapeHtml(text);
        
        // Map back to original positions
        const startPos = posMap[matchIdx];
        // Find the end position: we need the position AFTER the last matched character
        // The last normalized char is at matchIdx + qNorm.length - 1
        // We want to include the full original character at that position
        const lastNormIdx = matchIdx + qNorm.length - 1;
        const lastOrigPos = posMap[lastNormIdx];
        
        // Find the next original position that's different (or end of text)
        let endPosExclusive = lastOrigPos + 1;
        // Check if there are more normalized chars pointing to the same original position
        for (let i = lastNormIdx + 1; i < posMap.length; i++) {
          if (posMap[i] === lastOrigPos) {
            // Still part of the same original character
            continue;
          } else {
            // Next char starts here
            endPosExclusive = posMap[i];
            break;
          }
        }
        
        const before = text.slice(0, startPos);
        const match = text.slice(startPos, endPosExclusive);
        const after = text.slice(endPosExclusive);
        
        return `${escapeHtml(before)}<span style="color: var(--hover-select)">${escapeHtml(match)}</span>${escapeHtml(after)}`;
      }
      
      // Non-Japanese: simple regex match
      // Escape query HTML entities to match against escaped text (e.g., can't → can&#39;t)
      const escapedQ = escapeHtml(q);
      const re = new RegExp(escapeRegExp(escapedQ), "gi");
      return escapeHtml(text).replace(
        re,
        (match) => `<span style="color: var(--hover-select)">${match}</span>`
      );
    } catch (err) {
      console.warn('Highlight error:', err);
      return escapeHtml(text);
    }
  }

  // Highlight occurrences inside already-safe HTML (e.g., ruby markup) without escaping tags
  function highlightInsideHtmlPreserveTags(html: string, q: string, lang?: string): string {
    if (!q) return html;
    try {
      // For Japanese, do smart matching on visible text (strip brackets and tags)
      if (lang === 'ja' || hasJapanese(q)) {
        const qNorm = normalizeJapanese(q.trim());
        if (!qNorm) return html;

        // Strategy: detect ruby groups and if q matches the rt reading (normalized),
        // highlight both the entire rb and rt content. Otherwise fall back to visible text matching.

        // Process ruby groups first
        const rubyRe = /<ruby>\s*<rb>([\s\S]*?)<\/rb>\s*<rt>([\s\S]*?)<\/rt>\s*<\/ruby>/gi;
        let hasRubyHighlights = false;
        const processed = html.replace(rubyRe, (m, rbContent, rtContent) => {
          const rbNorm = normalizeJapanese(rbContent);
          const rtNorm = normalizeJapanese(rtContent);
          if (!rbNorm && !rtNorm) return m;
          // If query matches the rt (reading), highlight both rb and rt
          if (rtNorm.includes(qNorm) || rbNorm.includes(qNorm)) {
            hasRubyHighlights = true;
            return `<ruby><rb><span style="color: var(--hover-select)">${rbContent}</span></rb><rt><span style="color: var(--hover-select)">${rtContent}</span></rt></ruby>`;
          }
          return m;
        });

        if (hasRubyHighlights) {
          return processed;
        }

        // Fallback: original visible text approach (no ruby reading match found)
        const visibleChars: { char: string; htmlPos: number }[] = [];
        let i = 0;
        let inRtTag = false;

        while (i < html.length) {
          const char = html[i];

          if (char === '<') {
            const rtMatch = html.substring(i).match(/^<rt>/);
            const rtCloseMatch = html.substring(i).match(/^<\/rt>/);

            if (rtMatch) {
              inRtTag = true;
              i += rtMatch[0].length;
              continue;
            } else if (rtCloseMatch) {
              inRtTag = false;
              i += rtCloseMatch[0].length;
              continue;
            }

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
      
      // Non-Japanese: simple regex on whole HTML
      const escapedQ = escapeHtml(q);
      const re = new RegExp(escapeRegExp(escapedQ), "gi");
      return html.replace(re, (match) => `<span style="color: var(--hover-select)">${match}</span>`);
    } catch (err) {
      console.warn('Highlight error:', err);
      return html;
    }
  }


  // Load episode cards lazily on first A/D navigation (not on mount). Returns a promise that resolves when load is done (so caller can then navigate).
  const loadEpisodeCards = useCallback((): Promise<void> => {
    const filmId = initialCard.film_id;
    const episodeId = initialCard.episode_id || (typeof initialCard.episode === 'number' ? `e${initialCard.episode}` : String(initialCard.episode || ''));
    if (!filmId || !episodeId) return Promise.resolve();

    const finishLoad = (cards: CardDoc[], idx: number) => {
      episodeCardsDataRef.current = { cards, currentIndex: idx };
      setEpisodeCards(cards);
      setCurrentCardIndex(idx);
      setOriginalCardIndex(idx);
      const resolve = loadEpisodeResolveRef.current;
      loadEpisodeResolveRef.current = null;
      resolve?.();
    };
    const failLoad = () => {
      episodeCardsDataRef.current = null;
      setEpisodeCards([]);
      setCurrentCardIndex(-1);
      setOriginalCardIndex(-1);
      const resolve = loadEpisodeResolveRef.current;
      loadEpisodeResolveRef.current = null;
      resolve?.();
    };

    if (episodeCardsLoadedRef.current) {
      return Promise.resolve();
    }
    episodeCardsLoadedRef.current = true;

    const cacheKey = `${filmId}/${episodeId}`;
    const cached = episodeCardsCache.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      const idx = cached.cards.findIndex(c => Math.abs(c.start - initialCard.start) < 0.5);
      finishLoad(cached.cards, idx);
      return Promise.resolve();
    }

    const pendingRequest = pendingEpisodeRequests.get(cacheKey);
    if (pendingRequest) {
      return new Promise<void>((resolve) => {
        loadEpisodeResolveRef.current = resolve;
        pendingRequest.then(cards => {
          const idx = cards.findIndex(c => Math.abs(c.start - initialCard.start) < 0.5);
          finishLoad(cards, idx);
        }).catch(() => {
          failLoad();
        });
      });
    }

    const startTime = Math.max(0, initialCard.start - 250 * 5);
    const fetchPromise = fetchCardsForFilm(filmId, episodeId, 500, { startFrom: startTime }).then(cards => {
      episodeCardsCache.set(cacheKey, { cards, timestamp: Date.now() });
      pendingEpisodeRequests.delete(cacheKey);
      const idx = cards.findIndex(c => Math.abs(c.start - initialCard.start) < 0.5);
      if (idx >= 0) {
        finishLoad(cards, idx);
        return cards;
      }
      if (startTime > 0) {
        const fallbackCacheKey = `${filmId}/${episodeId}/start`;
        const fallbackCached = episodeCardsCache.get(fallbackCacheKey);
        if (fallbackCached && (now - fallbackCached.timestamp) < CACHE_TTL) {
          const fallbackIdx = fallbackCached.cards.findIndex(c => Math.abs(c.start - initialCard.start) < 0.5);
          finishLoad(fallbackCached.cards, fallbackIdx);
          return cards;
        }
        const fallbackPending = pendingEpisodeRequests.get(fallbackCacheKey);
        if (fallbackPending) {
          return fallbackPending.then(fallbackCards => {
            const fallbackIdx = fallbackCards.findIndex(c => Math.abs(c.start - initialCard.start) < 0.5);
            finishLoad(fallbackCards, fallbackIdx);
            return cards;
          }).catch(() => {
            failLoad();
            throw new Error('Failed to fetch fallback cards');
          });
        }
        return fetchCardsForFilm(filmId, episodeId, 500).then(fallbackCards => {
          episodeCardsCache.set(fallbackCacheKey, { cards: fallbackCards, timestamp: Date.now() });
          pendingEpisodeRequests.delete(fallbackCacheKey);
          const fallbackIdx = fallbackCards.findIndex(c => Math.abs(c.start - initialCard.start) < 0.5);
          finishLoad(fallbackCards, fallbackIdx);
          return cards;
        }).catch(() => {
          pendingEpisodeRequests.delete(fallbackCacheKey);
          failLoad();
          throw new Error('Failed to fetch fallback cards');
        });
      }
      finishLoad(cards, idx);
      return cards;
    }).catch(() => {
      pendingEpisodeRequests.delete(cacheKey);
      failLoad();
      throw new Error('Failed to fetch episode cards');
    });
    pendingEpisodeRequests.set(cacheKey, fetchPromise);

    return new Promise<void>((resolve) => {
      loadEpisodeResolveRef.current = resolve;
    });
  }, [initialCard]);

  // Play audio on image click
  const handleImageClick = () => {
    if (!card.audio_url) return;
    
    if (!audioRef.current) {
      audioRef.current = new Audio(card.audio_url);
      activeAudioInstances.add(audioRef.current);
      
      // Setup play listener for listening session tracking
      setupAudioPlayListener(audioRef.current);
      
      const handleAudioEnded = () => {
        setIsPlaying(false);
        // Reset listening session flag when audio ends so next play will increment again
        hasIncrementedListeningSession.current = false;
        // Stop tracking listening time when audio ends
        if (onTrackListening && listeningStartTimeRef.current) {
          const elapsed = Math.floor((Date.now() - listeningStartTimeRef.current) / 1000);
          if (elapsed > 0) {
            onTrackListening(elapsed);
          }
          listeningStartTimeRef.current = null;
        }
        if (listeningIntervalRef.current) {
          clearInterval(listeningIntervalRef.current);
          listeningIntervalRef.current = null;
        }
      };
      audioRef.current.addEventListener('ended', handleAudioEnded);
    } else {
      audioRef.current.src = card.audio_url;
      // Ensure play listener is set up for reused audio element (cleanup old one first if exists)
      cleanupAudioPlayListener(audioRef.current);
      setupAudioPlayListener(audioRef.current);
    }
    
    // Always set volume before any play/pause operation
    const normalizedVolume = Math.max(0, Math.min(100, volume)) / 100;
    audioRef.current.volume = normalizedVolume;
    
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      
      // Stop tracking listening time when paused
      if (onTrackListening && listeningStartTimeRef.current) {
        const elapsed = Math.floor((Date.now() - listeningStartTimeRef.current) / 1000);
        if (elapsed > 0) {
          onTrackListening(elapsed);
        }
        listeningStartTimeRef.current = null;
      }
      if (listeningIntervalRef.current) {
        clearInterval(listeningIntervalRef.current);
        listeningIntervalRef.current = null;
      }
    } else {
      // Pause all other audio instances before playing this one
      activeAudioInstances.forEach((otherAudio) => {
        if (otherAudio !== audioRef.current) {
          otherAudio.pause();
        }
      });
      // Reset listening session flag for new play session
      hasIncrementedListeningSession.current = false;
      // Set volume again right before playing to ensure it's applied
      audioRef.current.volume = normalizedVolume;
      audioRef.current.play().catch(err => console.warn('Audio play failed:', err));
      setIsPlaying(true);
      
      // Start tracking listening time
      if (onTrackListening) {
        listeningStartTimeRef.current = Date.now();
        // Track listening time every 5 seconds (as per requirements)
        listeningIntervalRef.current = setInterval(() => {
          if (listeningStartTimeRef.current) {
            const elapsed = (Date.now() - listeningStartTimeRef.current) / 1000;
            if (elapsed >= 5) {
              onTrackListening(5);
              listeningStartTimeRef.current = Date.now(); // Reset for next interval
            }
          }
        }, 5000);
      }
    }
  };

  // Navigate to previous card
  const handlePrevCard = async () => {
    let cards = episodeCards;
    let idx = currentCardIndex;
    if (cards.length === 0) {
      await loadEpisodeCards();
      const data = episodeCardsDataRef.current;
      if (!data) return;
      cards = data.cards;
      idx = data.currentIndex;
    }
    if (idx <= 0) return;
    const prevCard = cards[idx - 1];
    if (prevCard && card.film_id) {
      // Preload image to prevent jitter
      if (prevCard.image_url) await preloadImage(prevCard.image_url);
      // Fetch full card data with all subtitles
      try {
        const fullCard = await getCardByPath(
          card.film_id,
          prevCard.episode_id || card.episode_id || `e${card.episode}`,
          String(prevCard.id)
        );
        // Preserve levels from current card if new card doesn't have them
        const cardToSet = fullCard || prevCard;
        if (cardToSet.image_url && cardToSet.image_url !== prevCard.image_url) {
          await preloadImage(cardToSet.image_url);
        }
        setCard({
          ...cardToSet,
          levels: cardToSet.levels || card.levels,
          level_frequency_ranks: cardToSet.level_frequency_ranks ?? card.level_frequency_ranks ?? null
        });
        
        // Increment review count for the new card
        incrementReviewCountForCard(cardToSet);
      } catch {
        // Preserve levels from current card if new card doesn't have them
        setCard({
          ...prevCard,
          levels: prevCard.levels || card.levels,
          level_frequency_ranks: prevCard.level_frequency_ranks ?? card.level_frequency_ranks ?? null
        });
        
        // Increment review count for the new card
        incrementReviewCountForCard(prevCard);
      }
      setCurrentCardIndex(idx - 1);
      
      // Auto-play audio for the new card
      if (audioRef.current && prevCard.audio_url) {
        audioRef.current.src = prevCard.audio_url;
        // Set volume after src change (browser may reset volume when src changes)
        const normalizedVolume = Math.max(0, Math.min(100, volume)) / 100;
        audioRef.current.volume = normalizedVolume;
        // Pause all other audio instances
        activeAudioInstances.forEach((otherAudio) => {
          if (otherAudio !== audioRef.current) {
            otherAudio.pause();
          }
        });
        // Reset listening session flag for new card audio
        hasIncrementedListeningSession.current = false;
        // Ensure play listener is set up
        cleanupAudioPlayListener(audioRef.current);
        setupAudioPlayListener(audioRef.current);
        // Set volume again right before playing to ensure it's applied
        audioRef.current.volume = normalizedVolume;
        audioRef.current.play().catch(err => console.warn('Audio play failed:', err));
        setIsPlaying(true);
      } else {
        setIsPlaying(false);
        if (audioRef.current) {
          audioRef.current.pause();
        }
      }
    }
  };

  // Navigate to next card
  const handleNextCard = async () => {
    let cards = episodeCards;
    let idx = currentCardIndex;
    if (cards.length === 0) {
      await loadEpisodeCards();
      const data = episodeCardsDataRef.current;
      if (!data) return;
      cards = data.cards;
      idx = data.currentIndex;
    }
    if (idx < 0 || idx >= cards.length - 1) return;
    const nextCard = cards[idx + 1];
    if (nextCard && card.film_id) {
      // Preload image to prevent jitter
      if (nextCard.image_url) await preloadImage(nextCard.image_url);
      // Fetch full card data with all subtitles
      try {
        const fullCard = await getCardByPath(
          card.film_id,
          nextCard.episode_id || card.episode_id || `e${card.episode}`,
          String(nextCard.id)
        );
        // Preserve levels from current card if new card doesn't have them
        const cardToSet = fullCard || nextCard;
        if (!cardToSet.levels && card.levels) {
          cardToSet.levels = card.levels;
        }
        if (!cardToSet.level_frequency_ranks && card.level_frequency_ranks) {
          cardToSet.level_frequency_ranks = card.level_frequency_ranks;
        }
        if (cardToSet.image_url && cardToSet.image_url !== nextCard.image_url) {
          await preloadImage(cardToSet.image_url);
        }
        setCard(cardToSet);
        
        // Increment review count for the new card
        incrementReviewCountForCard(cardToSet);
      } catch {
        // Preserve levels from current card if new card doesn't have them
        setCard({
          ...nextCard,
          levels: nextCard.levels || card.levels,
          level_frequency_ranks: nextCard.level_frequency_ranks ?? card.level_frequency_ranks ?? null
        });
        
        // Increment review count for the new card
        incrementReviewCountForCard(nextCard);
      }
      setCurrentCardIndex(idx + 1);
      
      // Auto-play audio for the new card
      if (audioRef.current && nextCard.audio_url) {
        audioRef.current.src = nextCard.audio_url;
        // Set volume after src change (browser may reset volume when src changes)
        const normalizedVolume = Math.max(0, Math.min(100, volume)) / 100;
        audioRef.current.volume = normalizedVolume;
        // Pause all other audio instances
        activeAudioInstances.forEach((otherAudio) => {
          if (otherAudio !== audioRef.current) {
            otherAudio.pause();
          }
        });
        // Reset listening session flag for new card audio
        hasIncrementedListeningSession.current = false;
        // Ensure play listener is set up
        cleanupAudioPlayListener(audioRef.current);
        setupAudioPlayListener(audioRef.current);
        // Set volume again right before playing to ensure it's applied
        audioRef.current.volume = normalizedVolume;
        audioRef.current.play().catch(err => console.warn('Audio play failed:', err));
        setIsPlaying(true);
      } else {
        setIsPlaying(false);
        if (audioRef.current) {
          audioRef.current.pause();
        }
      }
    }
  };


  // Replay audio from beginning
  const handleReplayAudio = () => {
    if (!card.audio_url || !audioRef.current) return;
    
    audioRef.current.currentTime = 0;
    const normalizedVolume = Math.max(0, Math.min(100, volume)) / 100;
    audioRef.current.volume = normalizedVolume;
    // Pause all other audio instances before playing
    activeAudioInstances.forEach((otherAudio) => {
      if (otherAudio !== audioRef.current) {
        otherAudio.pause();
      }
    });
    // Reset listening session flag for new play session
    hasIncrementedListeningSession.current = false;
    // Set volume again right before playing to ensure it's applied
    audioRef.current.volume = normalizedVolume;
    audioRef.current.play().catch(err => console.warn('Audio replay failed:', err));
    setIsPlaying(true);
  };

  // Return to original card (C key)
  const handleReturnToOriginal = async () => {
    if (originalCardIndex < 0 || originalCardIndex >= episodeCards.length) {
      return;
    }
    if (currentCardIndex === originalCardIndex) {
      return; // Already at original
    }
    
    const originalCard = episodeCards[originalCardIndex];
    
    if (originalCard && card.film_id) {
      try {
        const fullCard = await getCardByPath(
          card.film_id,
          originalCard.episode_id || card.episode_id || `e${card.episode}`,
          String(originalCard.id)
        );
        // Preserve levels from current card if new card doesn't have them
        const cardToSet = fullCard || originalCard;
        if (!cardToSet.levels && card.levels) {
          cardToSet.levels = card.levels;
        }
        if (!cardToSet.level_frequency_ranks && card.level_frequency_ranks) {
          cardToSet.level_frequency_ranks = card.level_frequency_ranks;
        }
        setCard(cardToSet);
        
        // Increment review count for the original card
        incrementReviewCountForCard(cardToSet);
      } catch {
        // Preserve levels from current card if new card doesn't have them
        setCard({
          ...originalCard,
          levels: originalCard.levels || card.levels,
          level_frequency_ranks: originalCard.level_frequency_ranks ?? card.level_frequency_ranks ?? null
        });
        
        // Increment review count for the original card
        incrementReviewCountForCard(originalCard);
      }
      setCurrentCardIndex(originalCardIndex);
      
      // Auto-play audio for the original card
      if (audioRef.current && originalCard.audio_url) {
        audioRef.current.src = originalCard.audio_url;
        // Set volume after src change (browser may reset volume when src changes)
        const normalizedVolume = Math.max(0, Math.min(100, volume)) / 100;
        audioRef.current.volume = normalizedVolume;
        // Pause all other audio instances
        activeAudioInstances.forEach((otherAudio) => {
          if (otherAudio !== audioRef.current) {
            otherAudio.pause();
          }
        });
          // Reset listening session flag for original card audio
          hasIncrementedListeningSession.current = false;
          // Ensure play listener is set up
          cleanupAudioPlayListener(audioRef.current);
          setupAudioPlayListener(audioRef.current);
        // Set volume again right before playing to ensure it's applied
        audioRef.current.volume = normalizedVolume;
        audioRef.current.play().catch(err => console.warn('Audio play failed:', err));
        setIsPlaying(true);
      } else {
        setIsPlaying(false);
        if (audioRef.current) {
          audioRef.current.pause();
        }
      }
    }
  };

  // Move hover to previous card (Shift key)
  const handleMoveToPrevCardHover = () => {
    // Find all card elements on the page
    const allCards = document.querySelectorAll('.pixel-result-card-new');
    const currentCard = ref.current;
    
    if (!currentCard || allCards.length === 0) return;
    
    // Find current card index in DOM
    let currentIdx = -1;
    allCards.forEach((el, idx) => {
      if (el === currentCard) currentIdx = idx;
    });
    
    if (currentIdx > 0) {
      // Move to previous card
      const prevCard = allCards[currentIdx - 1] as HTMLElement;
      setIsHovered(false);
      prevCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Trigger hover on previous card after a brief delay
      setTimeout(() => {
        prevCard.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        // Auto-play audio on the newly hovered card
        setTimeout(() => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        }, 150);
      }, 300);
    }
  };

  // Move hover to next card (Enter key)
  const handleMoveToNextCardHover = () => {
    // Find all card elements on the page
    const allCards = document.querySelectorAll('.pixel-result-card-new');
    const currentCard = ref.current;
    
    if (!currentCard || allCards.length === 0) return;
    
    // Find current card index in DOM
    let currentIdx = -1;
    allCards.forEach((el, idx) => {
      if (el === currentCard) currentIdx = idx;
    });
    
    if (currentIdx >= 0 && currentIdx < allCards.length - 1) {
      // Move to next card
      const nextCard = allCards[currentIdx + 1] as HTMLElement;
      setIsHovered(false);
      nextCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Trigger hover on next card after a brief delay
      setTimeout(() => {
        nextCard.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        // Auto-play audio on the newly hovered card
        setTimeout(() => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        }, 150);
      }, 300);
    }
  };

  // Keep shortcut handlers ref up to date (must run after handlers are initialized)
  useEffect(() => {
    shortcutHandlersRef.current = {
      handlePrevCard: () => { void handlePrevCard(); },
      handleNextCard: () => { void handleNextCard(); },
      handleImageClick,
      handleReplayAudio,
      handleReturnToOriginal: () => { void handleReturnToOriginal(); },
      handleMoveToPrevCardHover,
      handleMoveToNextCardHover,
      handleToggleSave,
    };
  }, [
    handleImageClick,
    handleReplayAudio,
    handleMoveToPrevCardHover,
    handleMoveToNextCardHover,
    handleToggleSave,
    handleReturnToOriginal,
    handleNextCard,
    handlePrevCard,
  ]);

  // Keyboard shortcuts when card is hovered
  useEffect(() => {
    if (!isHovered) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      const handlers = shortcutHandlersRef.current;
      if (!handlers) return;

      if ((e.key === 'a' || e.key === 'A') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handlers.handlePrevCard();
      } else if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handlers.handleNextCard();
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        handlers.handleImageClick();
      } else if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handlers.handleReplayAudio();
      } else if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handlers.handleReturnToOriginal();
      } else if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handlers.handleToggleSave({ stopPropagation: () => {} } as React.MouseEvent);
      } else if (e.key === 'Shift') {
        e.preventDefault();
        handlers.handleMoveToPrevCardHover();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handlers.handleMoveToNextCardHover();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isHovered]);

  // add-to-deck deferred


  return (
    <div 
      ref={ref} 
      className={`pixel-result-card-new ${menuOpen ? 'menu-open' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="card-main-content">
        {/* Top: Metadata - Full width */}
        <div className="card-metadata-top">
          {/* Level badge (only first level for now) */}
          {card.levels && Array.isArray(card.levels) && card.levels.length > 0 && (
            (() => {
              const primaryLevel = card.levels[0].level || "";
              const primaryFramework = card.levels[0].framework || "CEFR";
              const colors = getLevelBadgeColors(primaryLevel);
              const normalize = (s: string) => String(s || '').trim().toLowerCase();
              const frameworkKey = normalize(primaryFramework);
              const freqEntry = card.level_frequency_ranks?.find(
                (f) => normalize(f.framework) === frameworkKey
              ) || card.level_frequency_ranks?.[0];
              const freqRank = typeof freqEntry?.frequency_rank === 'number' ? freqEntry.frequency_rank : null;
              return (
                <div
                  className="level-badges-container"
                  style={{
                    backgroundColor: colors.background,
                    color: colors.color,
                  }}
                >
                  <span className="level-badge-label">{primaryLevel}</span>
                  <span className="level-badge-number">{freqRank != null ? Math.round(freqRank) : '—'}</span>
                </div>
              );
            })()
          )}

          {/* Title chip */}
          <div className="card-title-chip">
            <span className="card-title-text">
              {filmTitle || card.content_title || card.episode_id || card.id}
            </span>
            <button
              type="button"
              className="card-star-btn"
              onClick={(e) => {
                e.stopPropagation();
                if (!user?.uid) {
                  toast.error('Please sign in to star content.');
                  return;
                }
                // Optimistic toggle
                const nextStarred = !isStarred;
                setIsStarred(nextStarred);
                // Call parent handler to hit the API
                if (onToggleStar && card.film_id) {
                  onToggleStar(card.film_id);
                }
              }}
              aria-pressed={isStarred}
              aria-label={isStarred ? 'Unstar content' : 'Star content'}
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

        {/* Top row: Left (image + bottom actions) + Center (subtitles) */}
        <div className="card-content-row">
          <div className="card-left-and-bottom">
            {/* Left: Image */}
            <div className="card-left-section">
            <div className="card-image-container">
            <div className="card-image-wrapper" title="Shortcuts: A/D (Navigate) • Space (Play) • R (Replay) • S (Save) • C (Return) • Shift/Enter (Move Hover)">
              {resolvedImageUrl && !imageError ? (
                <img
                  src={resolvedImageUrl}
                  alt={card.id}
                  decoding="async"
                  className="card-image"
                  onContextMenu={(e) => e.preventDefault()}
                  draggable={false}
                  onClick={handleImageClick}
                  style={{ 
                    cursor: card.audio_url ? 'pointer' : 'default',
                  }}
                  onError={() => setImageError(true)}
                />
              ) : (
                <div className="card-image-placeholder">
                  <span>{card.id}</span>
                </div>
              )}
              {card.audio_url && (
                <div className="card-image-play-overlay" onClick={handleImageClick} style={{ cursor: 'pointer', pointerEvents: 'all' }}>
                  <img src={headphoneIcon} alt="Listen" className="card-overlay-headphone-icon" />
                </div>
              )}
              
              {/* SRS State Dropdown - Top Left */}
              {isSaved && srsState !== 'none' && (
                <div className="card-srs-dropdown-container" ref={srsDropdownRef}>
                  <button
                    className={`card-srs-dropdown-btn srs-${srsState}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSrsDropdownOpen(!srsDropdownOpen);
                    }}
                  >
                    <span className="card-srs-dropdown-text">{SRS_STATE_LABELS[srsState]}</span>
                    <img src={buttonPlayIcon} alt="Dropdown" className="card-srs-dropdown-icon" />
                  </button>
                  
                  {srsDropdownOpen && (
                    <div className="card-srs-dropdown-menu">
                      {SELECTABLE_SRS_STATES.filter(s => s !== 'new').map((state) => (
                        <button
                          key={state}
                          className={`card-srs-dropdown-item srs-${state} ${srsState === state ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSRSStateChange(state);
                          }}
                        >
                          {SRS_STATE_LABELS[state]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              
              {/* Review Count - Bottom Right */}
              {user?.uid && (
                <div className="card-review-count">
                  <img src={headphoneIcon} alt="" className="card-review-count-headphone" aria-hidden="true" />
                  <span>{reviewCount}</span>
                </div>
              )}
            </div>
          </div>
          </div>

            {/* Bottom: Save, Prev/Play/Next, More options */}
            <div className="card-bottom-section">
              <div className="card-action-buttons">
                <button
                  className={`card-save-btn ${isSaved ? 'saved' : ''}`}
                  onClick={handleToggleSave}
                  title={isSaved ? "Unsave card" : "Save card"}
                >
                  <img src={saveHeartIcon} alt="" className="card-save-icon" aria-hidden="true" />
                  <span className="card-save-text">{isSaved ? 'Saved' : 'Save'}</span>
                </button>
              </div>
              <div className="card-nav-buttons-row">
                <button
                  type="button"
                  className="card-nav-icon-btn"
                  onClick={(e) => { e.stopPropagation(); handlePrevCard(); }}
                  title="Previous card (A)"
                  aria-label="Previous card"
                >
                  <img src={rightAngleIcon} alt="" className="card-nav-icon card-nav-prev" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="card-nav-icon-btn"
                  onClick={(e) => { e.stopPropagation(); handleImageClick(); }}
                  title={isPlaying ? "Pause (Space)" : "Play (Space)"}
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  <img
                    src={isPlaying ? buttonPauseIcon : buttonPlayIcon}
                    alt=""
                    className={`card-nav-icon ${isPlaying ? 'card-nav-pause' : ''}`}
                    aria-hidden="true"
                  />
                </button>
                <button
                  type="button"
                  className="card-nav-icon-btn"
                  onClick={(e) => { e.stopPropagation(); handleNextCard(); }}
                  title="Next card (D)"
                  aria-label="Next card"
                >
                  <img src={rightAngleIcon} alt="" className="card-nav-icon card-nav-next" aria-hidden="true" />
                </button>
              </div>
              <div className="card-menu-container" ref={menuRef}>
                <button
                  type="button"
                  className="pixel-btn-menu card-more-options-btn"
                  onClick={() => setMenuOpen(!menuOpen)}
                  title="More options"
                  aria-label="More options"
                  aria-expanded={menuOpen}
                >
                  <img src={threeDotsIcon} alt="" aria-hidden="true" />
                </button>
                {menuOpen && (
                  <div className="card-menu-dropdown">
                    <div
                      className="card-menu-item"
                      onClick={() => {
                        setMenuOpen(false);
                        if (card.film_id) {
                          // Prefer episode_slug (full slug from API, matches currentEpisode.slug in WatchPage),
                          // then episode_id, finally fallback to numeric episode with 'e' prefix.
                          const episodeSlug = card.episode_slug || card.episode_id || (typeof card.episode === 'number' ? `e${card.episode}` : String(card.episode));
                          navigate(`/watch/${card.film_id}?episode=${episodeSlug}&card=${card.id}`);
                        }
                      }}
                    >
                      <img src={eyeIcon} alt="View" className="menu-item-icon" />
                      View Card
                    </div>
                    <div
                      className="card-menu-item"
                      onClick={() => {
                        setMenuOpen(false);
                        alert("Report Issues feature coming soon!");
                      }}
                    >
                      <img src={warningIcon} alt="Report" className="menu-item-icon" />
                      Report Issues
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

        {/* Center: Subtitles + inline practice */}
        <div className="card-center-section">
          <div className="card-subtitles">
          {(() => {
            const primaryCode = primaryLang
              ? canonicalizeLangCode(primaryLang) || primaryLang
              : undefined;
            // Primary should be shown even when no subtitle text is present (audio language)
            const codeToName = (code: string): string => {
              const c = (canonicalizeLangCode(code) || code).toLowerCase();
              const map: Record<string, string> = {
                en: "english",
                vi: "vietnamese",
                // CJK: split theo biến thể Noto Sans
                zh: "chinese",          // Simplified Chinese → Noto Sans SC
                zh_trad: "chinese-tc",  // Traditional Chinese → Noto Sans TC
                yue: "cantonese",       // Cantonese → Noto Sans TC
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
              };
              return map[c] || c;
            };
            const effectiveCard = subsOverride ? { ...card, subtitle: { ...(card.subtitle || {}), ...subsOverride } } : card;
            const items = (practiceMode === "reading" && !readingRevealed)
              ? shownLangs.filter(c => c === primaryCode)
              : shownLangs;
            return items.map((code) => {
              let raw = subtitleText(effectiveCard, code) ?? "";
              const q = (highlightQuery ?? "").trim();
              const isPrimary = primaryCode === code;
              // If primary has no subtitle text, fallback to sentence so we can still show content
              if (isPrimary && !raw) {
                raw = effectiveCard.sentence ?? "";
              }
              const canon = (canonicalizeLangCode(code) || code).toLowerCase();
              const needsRuby = canon === "ja" || canon === "zh" || canon === "zh_trad" || canon === "yue";
              const name = codeToName(code);
              const roleClass = isPrimary ? `${name}-main` : `${name}-sub`;
              const rubyClass = needsRuby ? "hanzi-ruby" : "";
              const isExpanded = expandedSubtitles.has(code);
              const handleSubtitleMouseUp = () => {
                // Check if user is selecting text after mouse up
                // Use setTimeout to check after browser processes the selection
                setTimeout(() => {
                  const selection = window.getSelection();
                  if (selection && selection.toString().length > 0) {
                    // User is selecting text, don't toggle expand
                    return;
                  }
                  // No text selection, toggle expand
                  setExpandedSubtitles(prev => {
                    const next = new Set(prev);
                    if (next.has(code)) {
                      next.delete(code);
                    } else {
                      next.add(code);
                    }
                    return next;
                  });
                }, 0);
              };
              return (
                <div
                  key={code}
                  className={`${roleClass} ${rubyClass} subtitle-row ${isExpanded ? 'expanded' : ''}`}
                  style={{
                    position: "relative",
                    // Main language uses --text color, secondary uses CSS class colors
                    color: isPrimary ? "var(--text)" : undefined,
                    cursor: "pointer",
                  }}
                  onMouseUp={handleSubtitleMouseUp}
                  title={isExpanded ? "Click to collapse" : "Click to expand"}
                >
                  {practiceMode === "writing" && isPrimary && writingConfig
                    ? (() => {
                        return (
                          <span className="subtitle-text card-practice-cloze-line" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', overflow: 'visible', maxHeight: 'none' }}>
                            {writingWords.map((word, idx) => {
                              const isCorrect = writingChecked && writingConfig.tokens[idx] === writingWords[idx];
                              const isIncorrect = writingChecked && writingConfig.tokens[idx] !== writingWords[idx];
                              return (
                                <span
                                  key={idx}
                                  draggable
                                  onDragStart={() => handleWritingDragStart(idx)}
                                  onDragOver={(e) => handleWritingDragOver(e, idx)}
                                  onDragEnd={handleWritingDragEnd}
                                  style={{
                                    padding: '2px 8px',
                                    background: isCorrect
                                      ? 'var(--practice-blank-input-correct-bg)'
                                      : isIncorrect
                                        ? 'var(--practice-blank-input-incorrect-bg)'
                                        : 'var(--practice-blank-input-bg)',
                                    color: isCorrect
                                      ? 'var(--practice-blank-input-correct-text)'
                                      : isIncorrect
                                        ? 'var(--practice-blank-input-incorrect-text)'
                                        : 'var(--text)',
                                    borderRadius: '4px',
                                    cursor: writingChecked ? 'default' : 'grab',
                                    userSelect: 'none',
                                    border: `1px solid ${isCorrect
                                      ? 'var(--practice-blank-input-correct-border)'
                                      : isIncorrect
                                        ? 'var(--practice-blank-input-incorrect-border)'
                                        : 'var(--practice-blank-input-border)'}`,
                                    fontSize: 'inherit',
                                    lineHeight: '1.5',
                                  }}
                                >
                                  {word}
                                </span>
                              );
                            })}
                          </span>
                        );
                      })()
                    : practiceMode === "listening" && isPrimary && listeningClozeConfig
                    ? (() => {
                        const { tokens, blankTokenIndexes } = listeningClozeConfig;
                        return (
                          <span className="subtitle-text card-practice-cloze-line" style={{ overflow: 'visible', maxHeight: 'none' }}>
                            {tokens.map((word, idx) => {
                              const blankIndex = blankTokenIndexes.indexOf(idx);
                              const isBlank = blankIndex !== -1;
                              const space = idx < tokens.length - 1 ? " " : "";

                              if (!isBlank) {
                                return (
                                  <span key={`w-${idx}`} className="card-practice-word">
                                    {word}
                                    {space}
                                  </span>
                                );
                              }

                              const value = listeningAnswers[blankIndex] ?? "";
                              const isIncorrect =
                                listeningChecked && listeningIncorrect.includes(blankIndex);
                              const isCorrect =
                                listeningChecked && !listeningIncorrect.includes(blankIndex);

                              return (
                                <span key={`b-${idx}`} className="card-practice-blank-wrapper">
                                  <input
                                    type="text"
                                    ref={(el) => { listeningInputRefs.current[blankIndex] = el; }}
                                    className={
                                      "card-practice-blank-input" +
                                      (isCorrect ? " card-practice-blank-input-correct" : "") +
                                      (isIncorrect ? " card-practice-blank-input-incorrect" : "")
                                    }
                                    value={value}
                                    style={{ minWidth: '6ch', width: `${Math.max(6, (value || '').length + 2)}ch` }}
                                    onChange={(e) => {
                                      const newValue = e.target.value;
                                      setListeningAnswers((prev) => ({
                                        ...prev,
                                        [blankIndex]: newValue,
                                      }));
                                      // Auto-focus next blank when user types expected length
                                      const expectedLen = listeningClozeConfig.expectedNormalized[blankIndex]?.length || 3;
                                      if (newValue.length >= expectedLen && blankIndex < listeningClozeConfig.blankTokenIndexes.length - 1) {
                                        const nextIdx = listeningClozeConfig.blankTokenIndexes[blankIndex + 1];
                                        setTimeout(() => listeningInputRefs.current[nextIdx]?.focus(), 0);
                                      }
                                    }}
                                  />
                                  {space}
                                </span>
                              );
                            })}
                          </span>
                        );
                      })()
                    : (() => {
                        let html: string;
                        if (needsRuby) {
                          const normalized = normalizeCjkSpacing(raw);
                          const rubyHtml = bracketToRubyHtml(normalized, canon);
                          html = q ? highlightInsideHtmlPreserveTags(rubyHtml, q, canon) : rubyHtml;
                        } else {
                          html = q ? highlightHtml(raw, q) : escapeHtml(raw);
                        }
                        return (
                          <span
                            className="subtitle-text"
                            dangerouslySetInnerHTML={{ __html: html }}
                          />
                        );
                      })()}
                </div>
              );
            });
          })()}
        </div>

          {practiceMode === "listening" && listeningClozeConfig && (
            <div className="card-practice-footer-row">
              {!listeningChecked ? (
                <button
                  type="button"
                  className="card-practice-check-btn"
                  onClick={handleListeningCheck}
                  disabled={
                    isSubmittingListening ||
                    Object.keys(listeningAnswers).length === 0
                  }
                >
                  Check
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="card-practice-again-btn"
                    onClick={handleListeningAgain}
                  >
                    Again
                  </button>
                  <span className="card-practice-correct-answer">
                    {listeningClozeConfig.tokens
                      .map((token, idx) => {
                        const bi = listeningClozeConfig.blankTokenIndexes.indexOf(idx);
                        return bi >= 0
                          ? listeningClozeConfig.expectedNormalized[bi]
                          : token;
                      })
                      .join(" ")}
                  </span>
                  {listeningScore !== null && (
                    <span
                      className="card-practice-score"
                      style={{ color: (() => {
                        const s = listeningScore / 100;
                        const r = Math.round(201 - s * (201 - 46));
                        const g = Math.round(74 + s * (125 - 74));
                        const b = Math.round(74 + s * (50 - 74));
                        return `rgb(${r},${g},${b})`;
                      })() }}
                    >
                      {listeningScore.toFixed(2)}%
                    </span>
                  )}
                  {listeningXp !== null && (
                    <span className="card-practice-xp">
                      <img
                        src={diamondScoreIcon}
                        alt="XP"
                        className="card-practice-xp-icon"
                      />
                      <span className="card-practice-xp-text">
                        +{listeningXp}xp
                      </span>
                    </span>
                  )}
                </>
              )}
            </div>
          )}

          {practiceMode === "speaking" && (
            <div className="card-practice-footer-row">
              {!speakingChecked ? (
                <button
                  type="button"
                  className="card-practice-check-btn"
                  onClick={handleSpeakStart}
                  disabled={isRecording}
                >
                  {isRecording ? 'Recording...' : 'Speak'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="card-practice-again-btn"
                    onClick={handleSpeakAgain}
                  >
                    Again
                  </button>
                  {speakingTranscript && (
                    <span className={`card-practice-user-transcript ${
                      speakingScore !== null
                        ? (speakingScore >= 100 ? 'correct' : speakingScore >= 50 ? 'partial' : 'incorrect')
                        : ''
                    }`}>
                      {speakingTranscript}
                    </span>
                  )}
                  {speakingScore !== null && (
                    <span
                      className={`card-practice-score ${
                        speakingScore >= 100 ? 'correct' :
                        speakingScore >= 50 ? 'partial' : 'incorrect'
                      }`}
                    >
                      {speakingScore.toFixed(2)}%
                    </span>
                  )}
                  {recordedBlobUrl && (
                    <button
                      type="button"
                      className={`card-practice-replay-btn ${isPlayingRecording ? 'playing' : ''}`}
                      onClick={() => {
                        if (isPlayingRecording) {
                          audioPlaybackRef.current?.pause();
                          setIsPlayingRecording(false);
                        } else {
                          if (!audioPlaybackRef.current) {
                            audioPlaybackRef.current = new Audio(recordedBlobUrl);
                            audioPlaybackRef.current.onended = () => setIsPlayingRecording(false);
                          }
                          audioPlaybackRef.current.play();
                          setIsPlayingRecording(true);
                        }
                      }}
                      title={isPlayingRecording ? 'Pause' : 'Replay'}
                    >
                      {isPlayingRecording ? (
                        <img src="/src/assets/icons/button-pause.svg" alt="Pause" />
                      ) : (
                        <img src="/src/assets/icons/headphone.svg" alt="Replay" />
                      )}
                    </button>
                  )}
                  {speakingXp !== null && (
                    <span className="card-practice-xp">
                      <img
                        src={diamondScoreIcon}
                        alt="XP"
                        className="card-practice-xp-icon"
                      />
                      <span className="card-practice-xp-text">
                        +{speakingXp}xp
                      </span>
                    </span>
                  )}
                </>
              )}
            </div>
          )}

          {practiceMode === "reading" && (
            <div className="card-practice-footer-row">
              {!readingRevealed ? (
                <button
                  type="button"
                  className="card-practice-check-btn"
                  onClick={handleReadingShow}
                >
                  Show
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="card-practice-again-btn"
                    onClick={() => setReadingRevealed(false)}
                  >
                    Hide
                  </button>
                  {readingXp !== null && (
                    <span className="card-practice-xp">
                      <img
                        src={diamondScoreIcon}
                        alt="XP"
                        className="card-practice-xp-icon"
                      />
                      <span className="card-practice-xp-text">
                        +{readingXp}xp
                      </span>
                    </span>
                  )}
                </>
              )}
            </div>
          )}

          {practiceMode === "writing" && writingConfig && (
            <div className="card-practice-footer-row">
              {!writingChecked ? (
                <button
                  type="button"
                  className="card-practice-check-btn"
                  onClick={handleWritingCheck}
                >
                  Check
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="card-practice-again-btn"
                    onClick={handleWritingAgain}
                  >
                    Again
                  </button>
                  <span className="card-practice-correct-answer">
                    {writingConfig.tokens.join(' ')}
                  </span>
                  {writingScore !== null && (
                    <span className="card-practice-score">
                      {writingScore}%
                    </span>
                  )}
                  {writingXp !== null && (
                    <span className="card-practice-xp">
                      <img
                        src={diamondScoreIcon}
                        alt="XP"
                        className="card-practice-xp-icon"
                      />
                      <span className="card-practice-xp-text">
                        +{writingXp}xp
                      </span>
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for memo - only re-render if these props change
  // Need to compare subtitle keys to detect when subtitle data changes
  const prevSubKeys = prevProps.card.subtitle ? Object.keys(prevProps.card.subtitle).sort().join(',') : '';
  const nextSubKeys = nextProps.card.subtitle ? Object.keys(nextProps.card.subtitle).sort().join(',') : '';

  // Compare subtitle languages to ensure re-render when user selects new languages
  const prevLangs = (prevProps.subtitleLanguages || []).sort().join(',');
  const nextLangs = (nextProps.subtitleLanguages || []).sort().join(',');

  return (
    prevProps.card.id === nextProps.card.id &&
    prevProps.practiceMode === nextProps.practiceMode &&
    prevSubKeys === nextSubKeys &&
    prevLangs === nextLangs &&
    prevProps.highlightQuery === nextProps.highlightQuery &&
    prevProps.primaryLang === nextProps.primaryLang &&
    prevProps.filmTitle === nextProps.filmTitle &&
    prevProps.volume === nextProps.volume &&
    prevProps.initialSaveStatus?.saved === nextProps.initialSaveStatus?.saved &&
    prevProps.initialSaveStatus?.srs_state === nextProps.initialSaveStatus?.srs_state
  );
});

export default SearchResultCard;
