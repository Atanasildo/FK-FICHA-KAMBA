-- Identifies the two bookmaker-specific copies of one shared FK ticket.
alter table public.tickets
  add column if not exists shared_ticket_id uuid;

create index if not exists tickets_shared_ticket_id_idx
  on public.tickets (shared_ticket_id);
