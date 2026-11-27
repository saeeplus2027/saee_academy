PRAGMA foreign_keys = ON;

-- One completion marker per student and video. Deleting a student or video
-- removes its progress automatically through the foreign-key cascades.
CREATE TABLE IF NOT EXISTS video_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_video_progress_user_video
  ON video_progress(user_id, video_id);
