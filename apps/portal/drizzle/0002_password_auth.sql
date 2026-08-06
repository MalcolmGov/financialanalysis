-- Companion migration: password-based operator auth (replaces magic-link).
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
