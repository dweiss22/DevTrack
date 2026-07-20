-- Align persisted readable names and configured fallbacks with the names
-- currently returned by Wrike. Raw API payloads remain unchanged.

update public.wrike_users
set first_name='Koço',last_name='Budo',display_name='Koço Budo',updated_at=now()
where wrike_id='KUANTWID'
  and (first_name,last_name,display_name) is distinct from ('Koço','Budo','Koço Budo');

update public.wrike_users
set first_name='Jeffrey',last_name='Dino',display_name='Jeffrey Dino',updated_at=now()
where wrike_id='KUAQCQMG'
  and (first_name,last_name,display_name) is distinct from ('Jeffrey','Dino','Jeffrey Dino');
