-- TEMPORARY: top up Quest Points on the two test accounts so the economy
-- test suite can exercise real purchases/trades. Original balances are
-- restored exactly (not just "subtract what was spent") in the cleanup
-- migration at the end of this session's testing.
update public.profiles set quest_points = quest_points + 500 where id = '6f0316a8-cfb9-4328-b07f-a0d881bb5e9f'; -- James
update public.profiles set quest_points = quest_points + 500 where id = 'ce0be0a0-a083-4d04-bb6a-74e8ce7c53ae'; -- ducktest
