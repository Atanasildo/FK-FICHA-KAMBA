-- Estatísticas e eventos (golos, cartões) de cada jogo da página "Ao vivo".
alter table public.live_games
  add column if not exists stats jsonb,
  add column if not exists events jsonb,
  add column if not exists details_at timestamptz;
