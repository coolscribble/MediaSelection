export type Category = 'movies' | 'series' | 'anime' | 'manga' | 'games' | 'comics' | 'albums'
export const CATEGORIES: Category[] = ['movies', 'series', 'anime', 'manga', 'games', 'comics', 'albums']
export const CATEGORY_LABELS: Record<Category, string> = {
  movies: 'Movies', series: 'Series', anime: 'Anime', manga: 'Manga', games: 'Games', comics: 'Comics', albums: 'Albums',
}
export const CATEGORY_ICONS: Record<Category, string> = {
  movies: '🎬', series: '📺', anime: '⛩️', manga: '📚', games: '🎮', comics: '💬', albums: '🎵',
}

export interface LibraryItem {
  id: number
  category: Category
  title: string
  external_id: string | null
  thumbnail_url: string | null
  metadata: Record<string, unknown>
  source: string
}

export interface Slot {
  id: number
  category: Category
  slot_index: number
  item_id: number | null
  is_locked: boolean
  note: string | null
  current_progress: number
  title: string | null
  thumbnail_url: string | null
  external_id: string | null
  metadata: Record<string, unknown>
}

export type SlotsData = Record<Category, Slot[]>

export interface QueueItem {
  id: number
  category: Category
  position: number
  title: string
  thumbnail_url: string | null
  external_id: string | null
  metadata: Record<string, unknown>
  consumed: boolean
}

export interface AiringInfo {
  episodes_aired: number
  total_episodes: number | null
  next_episode: number | null
  next_air_time: number | null // milliseconds
}

export type OngoingCategoryId = 'series_ongoing' | 'anime_ongoing' | 'manga_ongoing' | 'comics_ongoing' | 'games_continuous'

export interface OngoingCategoryDef {
  id: OngoingCategoryId
  label: string
  icon: string
  syncSource: 'anilist' | 'simkl' | null
  resultKey: string | null
}

export const ONGOING_CATEGORIES: OngoingCategoryDef[] = [
  { id: 'series_ongoing',   label: 'TV Shows',         icon: '📺', syncSource: 'simkl',   resultKey: 'series' },
  { id: 'anime_ongoing',    label: 'Anime',            icon: '⛩️', syncSource: 'anilist', resultKey: 'anime' },
  { id: 'manga_ongoing',    label: 'Manga',            icon: '📚', syncSource: 'anilist', resultKey: 'manga' },
  { id: 'comics_ongoing',   label: 'Comics',           icon: '💬', syncSource: null,      resultKey: null },
  { id: 'games_continuous', label: 'Continuous Games', icon: '🎮', syncSource: null,      resultKey: null },
]

export interface OngoingItem {
  id: number
  category: OngoingCategoryId
  title: string
  thumbnail_url: string | null
  external_id: string | null
  metadata: Record<string, unknown>
  airing_info: AiringInfo | null
  watched_progress: number
  source: string
}

export interface Settings {
  simkl_client_id: string
  simkl_token_set: boolean
  anilist_username: string
  mal_username: string
  anilist_states: string[]
  simkl_states: string[]
  mal_anime_states: string[]
  mal_manga_states: string[]
  queue_modes: Record<Category, boolean>
  igdb_client_id: string
  igdb_client_set: boolean
  comicvine_api_set: boolean
  save_covers_locally: boolean
}

export const ANILIST_STATE_OPTIONS = [
  { value: 'PLANNING',   label: 'Planning' },
  { value: 'CURRENT',    label: 'Watching / Reading' },
  { value: 'PAUSED',     label: 'Paused' },
  { value: 'DROPPED',    label: 'Dropped' },
  { value: 'COMPLETED',  label: 'Completed' },
  { value: 'REPEATING',  label: 'Rewatching / Rereading' },
]

export const SIMKL_STATE_OPTIONS = [
  { value: 'plantowatch',    label: 'Plan to Watch' },
  { value: 'watching',       label: 'Watching' },
  { value: 'hold',           label: 'On Hold' },
  { value: 'dropped',        label: 'Dropped' },
  { value: 'completed',      label: 'Completed' },
  { value: 'notinteresting', label: 'Not Interested' },
]

export const MAL_ANIME_STATE_OPTIONS = [
  { value: 'plantowatch', label: 'Plan to Watch' },
  { value: 'watching',    label: 'Watching' },
  { value: 'completed',   label: 'Completed' },
  { value: 'onhold',      label: 'On Hold' },
  { value: 'dropped',     label: 'Dropped' },
]

export const MAL_MANGA_STATE_OPTIONS = [
  { value: 'plantoread', label: 'Plan to Read' },
  { value: 'reading',    label: 'Reading' },
  { value: 'completed',  label: 'Completed' },
  { value: 'onhold',     label: 'On Hold' },
  { value: 'dropped',    label: 'Dropped' },
]
