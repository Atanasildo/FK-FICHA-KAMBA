-- Universal AI access: per-agent credentials, audit trail and idempotent publishing.
-- Additive only. This file is committed to the development branch; it is NOT applied to production.

create table if not exists public.ai_agent_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_prefix text not null unique,
  key_hash text not null unique,
  scopes text[] not null default array['read:fixtures','write:analysis','publish:tickets']::text[],
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists ai_agent_keys_active_idx
  on public.ai_agent_keys (created_at desc) where revoked_at is null;

create table if not exists public.ai_agent_audit (
  id bigint generated always as identity primary key,
  agent_key_id uuid references public.ai_agent_keys(id) on delete set null,
  agent_name text not null,
  action text not null,
  resource_type text,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_agent_audit_created_idx
  on public.ai_agent_audit (created_at desc);
create index if not exists ai_agent_audit_agent_idx
  on public.ai_agent_audit (agent_key_id, created_at desc);

create table if not exists public.ai_agent_publications (
  id uuid primary key default gen_random_uuid(),
  agent_key_id uuid not null references public.ai_agent_keys(id),
  idempotency_key text not null,
  status text not null check (status in ('processing','published','not_published','failed')),
  response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_key_id, idempotency_key)
);

alter table public.ai_agent_keys enable row level security;
alter table public.ai_agent_audit enable row level security;
alter table public.ai_agent_publications enable row level security;

-- No anon/authenticated policies: only server-side service-role access is allowed.
