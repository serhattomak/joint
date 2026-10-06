// Column names mirror schema.sql exactly. Timestamps are ISO strings.
// favorite is boolean in TS, stored as INTEGER 0/1 in SQLite (mapped in client.ts).
export interface Collection {
  id: string;
  name: string;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export type DownloadStatus = 'none' | 'queued' | 'active' | 'done' | 'error';

export interface Item {
  id: string;
  url: string;
  title: string | null;
  note: string | null;
  platform: string;
  thumbnail: string | null;
  favorite: boolean;
  collection_id: string | null;
  user_id: string | null;
  local_path: string | null;
  download_status: DownloadStatus;
  download_error: string | null;
  converted_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  name: string;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItemChunkRow {
  id: string;
  item_id: string;
  chunk_type: 'meta' | 'note' | 'transcript' | 'article';
  chunk_text: string;
  start_seconds: number | null;
  end_seconds: number | null;
  embedding: string | null;
  created_at: string;
}

export interface HybridSearchResult {
  chunk: ItemChunkRow;
  item: Item;
  score: number;
  matchSource: 'fts' | 'vector' | 'both';
  fts_rank?: number;
  vector_sim?: number;
  combined_score?: number;
}

export interface ScrapedMedia {
  url: string;
  alt?: string | null;
  media_type: 'image' | 'video';
  caption?: string | null;
}

export type AnalysisStatus = 'pending' | 'running' | 'done' | 'partial' | 'error';

export interface RecipeText {
  title: string;
  ingredients: string[];
  steps: string[];
  notes: string;
}

export interface ItemAnalysis {
  id: string;
  item_id: string;
  status: AnalysisStatus;
  contains_recipe: boolean | null;
  confidence: number | null;
  language: string | null;
  summary: string | null;
  recipe: RecipeText | null;
  topics: string[];
  keywords: string[];
  visual_notes: string[] | null;
  transcript_source: string | null;
  transcript_path: string | null;
  model_versions: Record<string, string> | null;
  error_message: string | null;
  analyzed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItemArticle {
  item_id: string;
  title: string | null;
  content_text: string;
  content_markdown: string | null;
  author: string | null;
  published_at: string | null;
  reading_time_mins: number;
  lead_image: string | null;
  images_json: string | null;
  videos_json: string | null;
  site_name: string | null;
  scraped_at: string;
}
