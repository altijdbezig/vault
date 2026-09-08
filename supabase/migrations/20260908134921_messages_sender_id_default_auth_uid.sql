-- Zonder default moet de client sender_id meesturen, anders NOT NULL-violation.
-- De RLS-policy eist toch al sender_id = auth.uid().
alter table public.messages
  alter column sender_id set default auth.uid();
