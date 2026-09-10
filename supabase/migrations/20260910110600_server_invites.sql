-- Echte uitnodigingen: een korte code, optioneel met vervaldatum en maximum.

create table if not exists public.server_invites (
  -- De code is de sleutel. Kort genoeg om door te bellen, lang genoeg om niet
  -- te raden: 10 tekens uit een alfabet van 32 is ~50 bits.
  code text primary key,
  server_id uuid not null references public.servers(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Null = geen vervaldatum.
  expires_at timestamptz,
  -- Null = onbeperkt gebruik.
  max_uses integer,
  uses integer not null default 0,
  created_at timestamptz not null default now(),
  constraint server_invites_code_shape check (code ~ '^[a-z0-9]{6,32}$'),
  constraint server_invites_max_uses_positive check (max_uses is null or max_uses > 0)
);

create index if not exists server_invites_server_id_idx
  on public.server_invites (server_id);

alter table public.server_invites enable row level security;

-- ---------------------------------------------------------------------------
-- Lezen: ALLEEN beheerders. Dit is het belangrijkste stuk van deze migratie.
-- ---------------------------------------------------------------------------

-- De verleiding is een policy als "iedereen die is ingelogd mag een invite
-- lezen", zodat de client code -> server_id kan opzoeken. Dat werkt, en het
-- is fout: PostgREST past de policy per rij toe, maar het filter komt van de
-- client. Een ingelogde gebruiker vraagt dan simpelweg
--
--   GET /rest/v1/server_invites?select=*
--
-- en krijgt elke geldige uitnodigingscode van elke server terug. Eén request
-- en je zit in alle servers.
--
-- Daarom: lezen mag alleen als beheerder van die server (voor het
-- beheerscherm), en het inwisselen gaat via redeem_server_invite() hieronder.
drop policy if exists "beheerders zien uitnodigingen" on public.server_invites;
create policy "beheerders zien uitnodigingen"
  on public.server_invites for select
  to authenticated
  using (public.is_server_admin(server_id));

-- Aanmaken: beheerders, en alleen op eigen naam.
--
-- Kip-en-ei-controle: de client doet .insert().select() om de code terug te
-- krijgen en te kunnen tonen. Dat kan hier, want de select-policy hangt aan
-- is_server_admin(server_id) en dat was al waar voordat de rij bestond. Geen
-- 403 zoals bij channels in 20260908140321.
drop policy if exists "beheerders maken uitnodigingen" on public.server_invites;
create policy "beheerders maken uitnodigingen"
  on public.server_invites for insert
  to authenticated
  with check (
    public.is_server_admin(server_id)
    and created_by = auth.uid()
  );

-- Intrekken: beheerders.
drop policy if exists "beheerders trekken uitnodigingen in" on public.server_invites;
create policy "beheerders trekken uitnodigingen in"
  on public.server_invites for delete
  to authenticated
  using (public.is_server_admin(server_id));

-- Geen update-policy. `uses` wordt alleen door redeem_server_invite()
-- bijgewerkt, en die functie is SECURITY DEFINER en gaat dus om RLS heen. Een
-- update-policy zou betekenen dat een beheerder de teller kan terugzetten, en
-- dat is een feature die niemand gevraagd heeft.

-- ---------------------------------------------------------------------------
-- Inwisselen
-- ---------------------------------------------------------------------------

-- Alles in één functie, want het is één handeling die niet half mag lukken:
-- code valideren, lid worden van de server, lid worden van de kanalen, teller
-- bijwerken. Zou de client dit in vier requests doen, dan is er geen enkele
-- garantie dat hij bij request twee nog bestaat.
--
-- SECURITY DEFINER is hier onvermijdelijk: de aanroeper mag de invite-rij
-- juist NIET lezen (zie hierboven). De functie geeft daarom ook niets van de
-- rij terug behalve het server_id dat de gebruiker daarna toch al ziet.
--
-- Wat deze functie NIET doet: oudere berichten leesbaar maken. Die zijn
-- versleuteld voor de leden van toen. Dat is bewust en staat zo in CLAUDE.md.
create or replace function public.redeem_server_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite public.server_invites;
  v_uid uuid := auth.uid();
  v_added integer;
begin
  if v_uid is null then
    raise exception 'Niet ingelogd.' using errcode = '42501';
  end if;

  -- for update: twee mensen die tegelijk de laatste plek pakken moeten niet
  -- allebei binnenkomen.
  select * into v_invite
  from public.server_invites
  where code = lower(btrim(p_code))
  for update;

  if not found then
    raise exception 'Deze uitnodiging bestaat niet.' using errcode = 'P0002';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'Deze uitnodiging is verlopen.' using errcode = 'P0003';
  end if;

  if v_invite.max_uses is not null and v_invite.uses >= v_invite.max_uses then
    raise exception 'Deze uitnodiging is al opgebruikt.' using errcode = 'P0004';
  end if;

  -- where not exists in plaats van on conflict: dat werkt ook als er geen
  -- unieke constraint op (server_id, user_id) blijkt te staan.
  insert into public.server_members (server_id, user_id, role)
  select v_invite.server_id, v_uid, 'member'
  where not exists (
    select 1 from public.server_members sm
    where sm.server_id = v_invite.server_id and sm.user_id = v_uid
  );
  get diagnostics v_added = row_count;

  -- Serverlidmaatschap alleen is niet genoeg: berichten en ledensleutels
  -- hangen aan channel_members.
  insert into public.channel_members (channel_id, user_id)
  select c.id, v_uid
  from public.channels c
  where c.server_id = v_invite.server_id
    and not exists (
      select 1 from public.channel_members cm
      where cm.channel_id = c.id and cm.user_id = v_uid
    );

  -- Alleen tellen als er echt iemand bij kwam. Twee keer op dezelfde link
  -- klikken hoort geen gebruik te kosten, anders is een invite met max_uses 1
  -- opgebruikt door een dubbele tap.
  if v_added > 0 then
    update public.server_invites
    set uses = uses + 1
    where code = v_invite.code;
  end if;

  return v_invite.server_id;
end;
$$;

-- Zelfde dichtzetten als de andere helpers: anon heeft hier niets te zoeken.
revoke execute on function public.redeem_server_invite(text) from public, anon;
grant execute on function public.redeem_server_invite(text) to authenticated;
