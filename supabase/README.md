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
The frontend uses Supabase email OTP authentication. A signed-in user can save a comparison
from the Comparar Odds page. The Vercel Function `api/bookmakers/save-comparison.js`
validates the user's access token, then writes the match, bookmaker references, imported
market odds and comparison summary with the server-only service/secret key. The privileged
key is never included in the Vite bundle. RLS remains enabled and no anonymous write policies
are added.

## Current scope
Manual comparison imports remain local until the user explicitly chooses **Guardar na base de dados**.
The user must sign in with the email OTP flow. Automated bookmaker collection, AI ticket
publishing, live scores and ticket settlement are separate later integrations.
