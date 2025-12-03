// Global app types for Firestore data shapes used by the app

export type SubtitleMap = Record<string, string>; // e.g., { en: "Hello", ja: "こんにちは" }

export interface CardDoc {
  id: string; // card id (e.g., "000" or UUID)
  episode: number | string; // numeric order or episode identifier
  episode_id?: string; // normalized episode id (e.g., e1)
  start: number; // seconds (converted from ms in DB)
  end: number; // seconds (converted from ms in DB)
  duration?: number; // seconds
  audio_url: string; // fully qualified URL to audio resource
  image_url: string; // fully qualified URL to image resource
  subtitle: SubtitleMap; // aggregated subtitles keyed by language
  film_id?: string; // parent film id
  sentence?: string; // optional descriptive sentence
  CEFR_Level?: string; // proficiency level (legacy, prefer levels array)
  levels?: Array<{ framework: string; level: string; language?: string }>; // difficulty levels from various frameworks
  words?: Record<string, string>; // optional word breakdown
  card_type?: string; // normalized type text (cleaned sentence)
  length?: number; // length of card_type for matching/scoring
  difficulty_score?: number; // 0-100 fine-grained difficulty
  is_available?: boolean; // visibility flag (default: true)
}

export interface EpisodeDoc {
  id: string; // e.g., "e1"
  index?: number; // 1-based index
}

export interface FilmDoc {
  id: string; // film slug
  title?: string;
  description?: string;
  cover_url?: string; // derived from cover_key (R2 URL) if present
  cover_landscape_url?: string; // derived from cover_landscape_key (R2 URL) if present
  episodes?: number; // total episodes count
  total_episodes?: number; // business-intended total episodes (may exceed uploaded)
  main_language?: string; // new normalized schema primary language
  type?: string; // film/series/book/etc.
  release_year?: number;
  available_subs?: string[]; // collected from film_available_languages
  is_original?: boolean; // true if this is the original (source language) version
  // Aggregated statistics for the whole content item (optional)
  num_cards?: number | null;
  avg_difficulty_score?: number | null;
  level_framework_stats?: string | LevelFrameworkStats[] | null;
  is_available?: boolean; // visibility flag (default: true)
}

export interface UserPreferences {
  subtitle_languages: string[]; // chosen by user
  require_all_langs?: boolean; // when true, show only cards that include all selected languages
  main_language?: string; // user's preferred primary language (overrides film default in UI contexts)
}

export interface AppUser {
  uid: string;
  displayName?: string | null;
  email?: string | null;
  photoURL?: string | null;
  preferences?: UserPreferences;
  roles?: string[]; // user roles: 'user', 'admin', 'superadmin'
}

export interface UserEventLog {
  user_id: string;
  card_id: string;
  event: "view_card" | "play_audio" | "change_languages";
  timestamp: string; // ISO
  lang_selected?: string[];
}

// Stats structure: array of frameworks with optional language and levels percentage map
export interface LevelFrameworkEntry {
  framework: string;
  language?: string | null;
  levels: Record<string, number>; // level -> percentage (0-100 with decimals)
}
export type LevelFrameworkStats = LevelFrameworkEntry[];

// Episode detail shape returned by admin stats endpoint
export interface EpisodeDetailDoc {
  episode_number: number;
  slug: string;
  title: string | null;
  description?: string | null;
  cover_url: string | null;
  full_audio_url: string | null;
  full_video_url: string | null;
  num_cards?: number | null;
  avg_difficulty_score?: number | null;
  level_framework_stats?: string | LevelFrameworkStats[] | null;
  is_available?: boolean; // visibility flag (default: true)
}

// User progress tracking types
export interface UserCardProgress {
  id: number;
  user_id: string;
  film_id: string;
  episode_slug: string;
  card_id: string;
  card_index: number;
  completed_at: number; // Unix timestamp (milliseconds)
  created_at: number;
  updated_at: number;
}

export interface UserEpisodeStats {
  id: number;
  user_id: string;
  film_id: string;
  episode_slug: string;
  total_cards: number;
  completed_cards: number;
  last_card_index: number;
  completion_percentage: number; // 0-100
  last_accessed_at: number; // Unix timestamp (milliseconds)
  created_at: number;
  updated_at: number;
}

// API request/response types for progress
export interface MarkCardCompleteRequest {
  user_id: string;
  film_id: string;
  episode_slug: string;
  card_id: string;
  card_index: number;
  total_cards?: number; // Optional: helps update episode stats
}

export interface GetProgressResponse {
  episode_stats: UserEpisodeStats | null;
  completed_cards: UserCardProgress[];
  completed_card_ids: Set<string>;
  completed_indices: Set<number>;
}
