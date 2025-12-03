-- Migration 011: Add Password Authentication Support
-- Add password hash column for email/password authentication

-- Step 1: Add password hash column to users table
ALTER TABLE users ADD COLUMN password_hash TEXT;

-- Step 2: Add password reset token support
ALTER TABLE users ADD COLUMN reset_token TEXT;
ALTER TABLE users ADD COLUMN reset_token_expires INTEGER;

-- Step 3: Create index for reset token lookup
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token);

-- Step 4: Add email verification token
ALTER TABLE users ADD COLUMN verification_token TEXT;
ALTER TABLE users ADD COLUMN verification_token_expires INTEGER;

-- Step 5: Create index for verification token lookup
CREATE INDEX IF NOT EXISTS idx_users_verification_token ON users(verification_token);
