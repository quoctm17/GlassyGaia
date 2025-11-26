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
  CEFR_Level?: string; // proficiency level
  words?: Record<string, string>; // optional word breakdown
  card_type?: string; // normalized type text (cleaned sentence)
  length?: number; // length of card_type for matching/scoring
  difficulty_score?: number; // 0-100 fine-grained difficulty
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
  cover_url: string | null;
  full_audio_url: string | null;
  full_video_url: string | null;
  num_cards?: number | null;
  avg_difficulty_score?: number | null;
  level_framework_stats?: string | LevelFrameworkStats[] | null;
}
