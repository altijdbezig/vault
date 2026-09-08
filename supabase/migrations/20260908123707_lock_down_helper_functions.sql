-- De helperfuncties zijn SECURITY DEFINER en waren via /rest/v1/rpc/
-- aanroepbaar door anon. Alleen ingelogde gebruikers hebben ze nodig.
revoke execute on function public.is_channel_member(uuid) from public, anon;
revoke execute on function public.is_server_member(uuid) from public, anon;
grant execute on function public.is_channel_member(uuid) to authenticated;
grant execute on function public.is_server_member(uuid) to authenticated;
