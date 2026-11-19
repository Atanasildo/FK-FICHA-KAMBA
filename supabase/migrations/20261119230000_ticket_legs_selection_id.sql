-- Guarda o SelectionId do Swarm em cada selecção do boletim, para a reserva
-- (create_bet_book_v2) poder ser pedida a partir do boletim publicado.
alter table public.ticket_legs add column if not exists selection_id text;
