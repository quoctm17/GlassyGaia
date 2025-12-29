-- Migration 024: Add IMDB Score and Categories system to content_items
-- Adds imdb_score column to content_items and creates categories tables
-- SAFE: Uses ALTER TABLE ADD COLUMN (does NOT drop or recreate tables)

-- Add imdb_score column to content_items (REAL = floating point number)
ALTER TABLE content_items ADD COLUMN imdb_score REAL;

-- Create categories table
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT UNIQUE NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Create junction table for many-to-many relationship between content_items and categories
CREATE TABLE IF NOT EXISTS content_item_categories (
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (content_item_id, category_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_content_item_categories_item ON content_item_categories(content_item_id);
CREATE INDEX IF NOT EXISTS idx_content_item_categories_category ON content_item_categories(category_id);
CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name);

