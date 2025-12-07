-- Migration 014: Recreate v_user_profiles view without deprecated columns
-- Drop the old view that references is_admin and role columns
DROP VIEW IF EXISTS v_user_profiles;

-- Recreate view without deprecated columns, using user_roles table instead
CREATE VIEW v_user_profiles AS
SELECT 
  u.id,
  u.email,
  u.display_name,
  u.photo_url,
  u.auth_provider,
  u.is_active,
  u.created_at,
  u.updated_at,
  u.last_login_at,
  u.email_verified,
  -- Get roles from user_roles table as comma-separated string
  GROUP_CONCAT(ur.role_name) as roles,
  -- User preferences
  p.main_language,
  p.subtitle_languages,
  p.require_all_languages,
  p.difficulty_min,
  p.difficulty_max,
  p.auto_play,
  p.playback_speed,
  p.theme,
  p.show_romanization
FROM users u
LEFT JOIN user_preferences p ON u.id = p.user_id
LEFT JOIN user_roles ur ON u.id = ur.user_id
GROUP BY u.id;
