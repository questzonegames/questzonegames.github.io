-- TEMPORARY QA fixtures for the item economy foundation — is_test=true,
-- item_id prefixed qa-test- so cleanup can find them unambiguously.
insert into public.item_definitions
  (item_id, name, equipment_slot, tradeable, instancing_mode, stock_type, edition_size, shop_price, currency_type, active, is_test)
values
  ('qa-test-a', 'QA Test A (unlimited stackable tradeable)', null, true,  'stack',    'unlimited', null, 10, 'quest_points', true, true),
  ('qa-test-b', 'QA Test B (unlimited untradeable)',          null, false, 'simple',   'unlimited', null, 10, 'quest_points', true, true),
  ('qa-test-c', 'QA Test C (limited x10 tradeable)',          null, true,  'instance', 'limited',   10,   5,  'quest_points', true, true),
  ('qa-test-d', 'QA Test D (limited x10 untradeable)',        null, false, 'instance', 'limited',   10,   5,  'quest_points', true, true)
on conflict (item_id) do nothing;
