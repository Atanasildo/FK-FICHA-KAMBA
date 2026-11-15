-- Expose only completed, usable analyses to the public Ficha Kamba frontend.
-- Writes remain restricted to trusted server-side/service-role access.
create policy "Public reads ready analyses"
on public.match_analyses
for select
to anon, authenticated
using (status = 'ready');
