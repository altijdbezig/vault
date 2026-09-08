-- Kip-en-ei: de select-policy was alleen is_channel_member(id). Een net
-- aangemaakt kanaal heeft nog geen leden, dus de maker kon zijn eigen kanaal
-- niet teruglezen. Daardoor faalde .insert().select('id') in createDm.
drop policy "leden zien hun kanaal" on public.channels;

create policy "leden zien hun kanaal"
  on public.channels for select
  to authenticated using (
    created_by = auth.uid()
    or public.is_channel_member(id)
    or (server_id is not null and public.is_server_member(server_id))
  );
