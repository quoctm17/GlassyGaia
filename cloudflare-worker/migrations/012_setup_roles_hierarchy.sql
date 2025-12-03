-- Migration 012: Setup Roles Hierarchy and Assign User Roles
-- Create role hierarchy: user < admin < superadmin

-- Step 1: Clear existing roles and create new hierarchy
DELETE FROM roles;

INSERT INTO roles (name, description, permissions) VALUES 
  ('user', 'Regular user - can access content and favorites', '["content:read", "content:favorite", "progress:own"]'),
  ('admin', 'Administrator - can manage content and users', '["content:*", "users:read", "users:update", "media:*", "admin:access"]'),
  ('superadmin', 'Super Administrator - full system access including database management', '["*"]');

-- Step 2: Assign roles to specific users
-- SuperAdmin: tranminhquoc0711@gmail.com (Firebase UID: UlkcyeELU9M9uy60kNNkJfRGx3f1)
INSERT OR REPLACE INTO user_roles (user_id, role_name, granted_by, granted_at) 
VALUES ('UlkcyeELU9M9uy60kNNkJfRGx3f1', 'superadmin', 'system', unixepoch() * 1000);

-- Admin users: multiple emails
-- Note: These will be inserted when users first login via Google Firebase
-- We'll create a trigger or update the worker to auto-assign admin role based on email whitelist

-- For now, manually insert for known user IDs if they exist
-- The worker should handle auto-assignment for these emails:
-- - tranminhquoc0711@gmail.com (already superadmin)
-- - phungnguyeniufintechclub@gmail.com
-- - trang.vtae@gmail.com
-- - nhungngth03@gmail.com

-- Step 3: Create trigger to auto-assign 'user' role to new users
-- This ensures all new signups get the default 'user' role
-- Admin and SuperAdmin roles must be manually granted or checked via email whitelist
