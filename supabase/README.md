# Supabase foundation (FK)

## Vercel environment
The Vite frontend reads only:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` (preferred), or `VITE_SUPABASE_ANON_KEY`

These are public client credentials and must be protected by Supabase RLS. Never expose
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, database passwords, or JWT secrets
through a `VITE_` variable or browser bundle.

The Vercel integration has already supplied the existing Supabase project's URL and
publishable/anon key. The Vite-prefixed Production variables were added separately.

## Install schema
1. Open the existing Supabase project **Ficha-Kamba**.
2. Open SQL Editor and create a new query.
3. Paste and run `supabase/schema.sql`.
The migration uses CREATE IF NOT EXISTS and does not drop existing tables/data. It creates
bookmakers, matches, markets, tickets, ticket_legs and odds_comparisons with RLS enabled.
Only published tickets and their legs are publicly readable. No public write policies exist.

## App client
`src/lib/supabase.js` exports `supabase` and `isSupabaseConfigured`.
The frontend client is intentionally limited to public read operations. Trusted collection,
AI, publishing and cron jobs must use a server-only Supabase secret key, with strict
authorization and validation, in a later backend implementation.

## Current scope
This is the database foundation, not yet the complete automated collection/publishing
pipeline. Existing manual odds comparison remains local until server persistence is added.
