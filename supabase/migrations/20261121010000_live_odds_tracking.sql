alter table public.ticket_legs
  add column if not exists current_odd numeric,
  add column if not exists current_odd_at timestamptz,
  add column if not exists odd_state text;
alter table public.tickets
  add column if not exists current_total_odds numeric,
  add column if not exists current_odds_at timestamptz;
comment on column public.ticket_legs.current_odd is 'Odd actual da casa para esta selecção (recolhida no PC via Swarm).';
comment on column public.ticket_legs.odd_state is 'open | suspended (a casa já não oferece a selecção)';
