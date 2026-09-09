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
