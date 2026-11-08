-- FK pipeline extension: retain sourced match context and auditable AI analyses.
-- Safe to apply more than once; no existing rows are dropped.
create table if not exists public.match_statistics (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  source text not null,
  payload jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists match_statistics_match_time_idx
  on public.match_statistics(match_id, collected_at desc);

create table if not exists public.match_analyses (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  provider text not null default 'Groq',
  model text,
  status text not null check (status in ('ready','insufficient_data','rejected')),
  summary text,
  analysis jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists match_analyses_match_time_idx
  on public.match_analyses(match_id, generated_at desc);

alter table public.match_statistics enable row level security;
alter table public.match_analyses enable row level security;

-- No public write/read policy: these records are managed by trusted server functions.
