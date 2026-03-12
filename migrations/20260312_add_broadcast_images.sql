-- Create broadcast_images table for persistent image storage
CREATE TABLE IF NOT EXISTS broadcast_images (
  id SERIAL PRIMARY KEY,
  image_id VARCHAR(100) UNIQUE NOT NULL,
  filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(50) NOT NULL,
  file_size INTEGER NOT NULL,
  image_data BYTEA NOT NULL,
  uploaded_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on image_id for fast lookup
CREATE INDEX IF NOT EXISTS idx_broadcast_images_image_id ON broadcast_images(image_id);

-- Create index on uploaded_by for user-based queries
CREATE INDEX IF NOT EXISTS idx_broadcast_images_uploaded_by ON broadcast_images(uploaded_by);

COMMENT ON TABLE broadcast_images IS 'Persistent storage for broadcast images';
COMMENT ON COLUMN broadcast_images.image_id IS 'Unique identifier for the image (e.g., img_1710234567_abc123)';
COMMENT ON COLUMN broadcast_images.image_data IS 'Binary image data stored as BYTEA';
