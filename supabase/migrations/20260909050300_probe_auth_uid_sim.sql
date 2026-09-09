do $$
declare
  v_check uuid;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"6f0316a8-cfb9-4328-b07f-a0d881bb5e9f","role":"authenticated"}';
  select auth.uid() into v_check;
  if v_check::text = '6f0316a8-cfb9-4328-b07f-a0d881bb5e9f' then
    raise notice 'PROBE PASS: auth.uid() simulation works, got %', v_check;
  else
    raise exception 'PROBE FAIL: auth.uid() returned % instead of expected uuid', v_check;
  end if;
end $$;
