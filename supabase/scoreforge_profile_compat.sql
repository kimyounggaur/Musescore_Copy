-- Compatibility for projects where profiles predates ScoreForge auth.
-- CREATE TABLE IF NOT EXISTS does not add missing columns to existing tables.
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- Trigger-only helper; schema usage must not make it a public callable helper.
revoke all on function private.handle_new_user() from public, anon, authenticated;

notify pgrst, 'reload schema';
