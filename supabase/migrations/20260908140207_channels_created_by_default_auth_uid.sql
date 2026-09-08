-- Zelfde patroon. De insert-policy eist created_by = auth.uid(); zonder
-- default is de kolom NULL en faalt de insert met een 403.
alter table public.channels
  alter column created_by set default auth.uid();
