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
4. Paste and run `supabase/migrations/20261108_match_context.sql`.
Both scripts are additive and do not drop existing tables/data. The extension adds
`match_statistics` and `match_analyses`; RLS is enabled and no public policies are added.
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
The user must sign in with the email OTP flow. Automatic bookmaker collection, ticket generation/publication, live scores and ticket settlement
are still pending. `api/ai-analyze.js` now requires supplied match statistics and makes the AI
select markets without seeing odds; only afterwards does it compare the two bookmakers and
keep selections with at least two quotes and a best odd of 1.40 or more. The protected
`api/pipeline/save-analysis.js` stores sourced statistics, AI analyses and verified odds.
It does not publish tickets or create bookmaker reservation references.
