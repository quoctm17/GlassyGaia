-- Migration 010: Enhance User Management System
-- Add support for multiple auth providers and improve role management

-- Step 1: Add new columns to users table
ALTER TABLE users ADD COLUMN provider_user_id TEXT;
ALTER TABLE users ADD COLUMN provider_data TEXT;
ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN phone_number TEXT;
ALTER TABLE users ADD COLUMN phone_verified INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN account_locked INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN lockout_until INTEGER;
ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';

-- Step 2: Create indexes for new columns
CREATE INDEX IF NOT EXISTS idx_users_provider ON users(auth_provider, provider_user_id);
CREATE INDEX IF NOT EXISTS idx_users_email_verified ON users(email, email_verified);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Step 3: Create auth_providers lookup table
CREATE TABLE IF NOT EXISTS auth_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_name TEXT NOT NULL UNIQUE,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  config TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

INSERT OR IGNORE INTO auth_providers (provider_name, is_enabled) VALUES 
  ('google', 1),
  ('firebase', 1),
  ('email', 1),
  ('local', 1);

-- Step 4: Create user_logins table
CREATE TABLE IF NOT EXISTS user_logins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  login_method TEXT,
  ip_address TEXT,
  user_agent TEXT,
  success INTEGER NOT NULL DEFAULT 1,
  failure_reason TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_user_logins_user ON user_logins(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_logins_method ON user_logins(login_method);

-- Step 5: Create roles table
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  permissions TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

INSERT OR IGNORE INTO roles (name, description, permissions) VALUES 
  ('admin', 'Full system access', '["*"]'),
  ('moderator', 'Can manage content and users', '["content:*", "users:read", "users:update"]'),
  ('vip', 'Premium user with extra features', '["content:read", "content:favorite", "stats:view"]'),
  ('user', 'Regular user', '["content:read", "content:favorite"]');

-- Step 6: Create user_roles junction table
CREATE TABLE IF NOT EXISTS user_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  role_name TEXT NOT NULL,
  granted_by TEXT,
  granted_at INTEGER DEFAULT (unixepoch() * 1000),
  expires_at INTEGER,
  UNIQUE(user_id, role_name)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_name);
