-- Migration 013: Remove deprecated role columns from users table
-- Now using user_roles table for role management

-- Drop view that depends on these columns first
DROP VIEW IF EXISTS v_user_profiles;

-- Drop index that depends on the role column
DROP INDEX IF EXISTS idx_users_role;

-- Remove is_admin column (deprecated - now using user_roles table)
ALTER TABLE users DROP COLUMN is_admin;

-- Remove role column (deprecated - now using user_roles table)
ALTER TABLE users DROP COLUMN role;
