-- Todos os jogos em directo (e os terminados nas últimas horas), para a página "Ao vivo".
-- Uma linha por jogo, actualizada no lugar (poucas centenas de linhas): não pressiona o limite do plano.
-- Escritas: só o colector do PC (service role). Leitura pública: o site.
create table if not exists public.live_games (
  sofascore_id text primary key,
  home_team text not null,
  away_team text not null,
  competition text,
  country text,
  status text not null,
  home_score integer,
  away_score integer,
  minute integer,
  kickoff_at timestamptz not null,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists live_games_kickoff_idx on public.live_games (kickoff_at desc);
alter table public.live_games enable row level security;
create policy "Public reads live games" on public.live_games for select to anon, authenticated using (true);
