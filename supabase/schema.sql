-- FK — Ficha Kamba
-- Apply in Supabase SQL Editor. This migration is additive and does not drop existing data.
create extension if not exists pgcrypto;

create table if not exists public.bookmakers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  website_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  home_team text not null,
  away_team text not null,
  competition text,
  kickoff_at timestamptz,
  status text not null default 'scheduled',
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create table if not exists public.markets (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  bookmaker_id uuid not null references public.bookmakers(id) on delete cascade,
  market_name text not null,
  market_key text not null,
  period text not null default 'full_time',
  line text,
  selection text not null,
  odd numeric(12,4) not null check (odd > 1 and odd <= 10000),
  source_url text,
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists markets_match_key_idx on public.markets(match_id, market_key, line);
create index if not exists markets_collected_at_idx on public.markets(collected_at desc);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'draft' check (status in ('draft','published','settled','cancelled')),
  total_odds numeric(14,4),
  booking_reference text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ticket_legs (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  match_id uuid references public.matches(id) on delete set null,
  market_id uuid references public.markets(id) on delete set null,
  market_name text not null,
  selection text not null,
  odd numeric(12,4) not null check (odd > 1 and odd <= 10000),
  result text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.odds_comparisons (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.matches(id) on delete set null,
  comparison jsonb not null default '{}'::jsonb,
  best_prices jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.bookmakers enable row level security;
alter table public.matches enable row level security;
alter table public.markets enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_legs enable row level security;
alter table public.odds_comparisons enable row level security;

-- Public users can only read active bookmaker references and published match/ticket data.
drop policy if exists "Public reads active bookmakers" on public.bookmakers;
create policy "Public reads active bookmakers" on public.bookmakers
  for select using (active = true);

drop policy if exists "Public reads matches" on public.matches;
create policy "Public reads matches" on public.matches
  for select using (true);

drop policy if exists "Public reads markets" on public.markets;
create policy "Public reads markets" on public.markets
  for select using (true);

drop policy if exists "Public reads published tickets" on public.tickets;
create policy "Public reads published tickets" on public.tickets
  for select using (status = 'published');

drop policy if exists "Public reads legs of published tickets" on public.ticket_legs;
create policy "Public reads legs of published tickets" on public.ticket_legs
  for select using (
    exists (select 1 from public.tickets t where t.id = ticket_id and t.status = 'published')
  );

drop policy if exists "Public reads comparisons" on public.odds_comparisons;
create policy "Public reads comparisons" on public.odds_comparisons
  for select using (true);

-- No anonymous/authenticated write policies are created. Trusted server jobs must write
-- through a server-only secret key stored in Vercel, never exposed to Vite/browser code.
