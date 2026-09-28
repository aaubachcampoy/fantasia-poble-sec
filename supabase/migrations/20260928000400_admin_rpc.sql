-- Jornades, resultats i jugadors (admin) + tasques programades.

-- Bloqueig de la jornada (dissabte 09:00): congela les alineacions de tots els mànagers.
create function private.lock_matchday(p_matchday bigint) returns void
language plpgsql set search_path = '' as $$
begin
  update public.matchdays set status = 'locked', locked_at = now() where id = p_matchday and status = 'upcoming';
  insert into public.lineup_snapshots (manager_id, matchday_id, league_id, slots, captain_id)
  select l.manager_id, p_matchday, m.league_id, l.slots,
         case when array_position(l.slots[1:11], l.captain_id) is not null then l.captain_id end
  from public.lineups l
  join public.managers m on m.id = l.manager_id
  join public.leagues lg on lg.id = m.league_id
  join public.matchdays md on md.id = p_matchday and md.season_id = lg.season_id
  on conflict do nothing;
end $$;

-- Punts dels mànagers en una jornada: només l'onze congelat, capità ×2.
create function private.recalc_scores(p_matchday bigint) returns void
language sql set search_path = '' as $$
  insert into public.manager_scores (manager_id, matchday_id, league_id, points)
  select s.manager_id, s.matchday_id, s.league_id,
         coalesce(sum(pp.points * case when x.pid = s.captain_id then 2 else 1 end), 0)
  from public.lineup_snapshots s
  left join lateral unnest(s.slots[1:11]) as x(pid) on true
  left join public.player_points pp on pp.player_id = x.pid and pp.matchday_id = s.matchday_id
  where s.matchday_id = p_matchday
  group by s.manager_id, s.matchday_id, s.league_id
  on conflict (manager_id, matchday_id) do update set points = excluded.points
$$;

-- Jornada oberta a resultats (bloqueja-la si ja toca). Error si encara no ha començat o ja està tancada.
create function private.require_results_open(p_matchday bigint) returns void
language plpgsql set search_path = '' as $$
declare md public.matchdays;
begin
  select * into md from public.matchdays where id = p_matchday;
  if md.status = 'closed' then perform private.fail('CLOSED', 'Aquesta jornada ja està tancada.'); end if;
  if md.status = 'upcoming' then
    if not private.lock_due(p_matchday) then
      perform private.fail('NOT_STARTED', 'Els resultats s’obren quan comenci la jornada.');
    end if;
    perform private.lock_matchday(p_matchday);
  end if;
end $$;

-- Publica: copia l'acta als punts que veuen totes les lligues i recalcula.
create function private.publish_fixture(p_fixture bigint) returns void
language plpgsql set search_path = '' as $$
declare
  f public.fixtures;
  sh public.match_sheets;
begin
  select * into f from public.fixtures where id = p_fixture for update;
  select * into sh from public.match_sheets where fixture_id = p_fixture;
  if not found then perform private.fail('NO_SHEET', 'Encara no hi ha resultat per publicar.'); end if;
  delete from public.player_points where fixture_id = p_fixture;
  insert into public.player_points (fixture_id, player_id, matchday_id, points, breakdown)
  select s.fixture_id, s.player_id, f.matchday_id, c.points, c.breakdown
  from public.player_stats s
  join public.players p on p.id = s.player_id
  cross join lateral private.calc_points(p.position, s.minutes, s.goals, s.assists, s.yellow, s.red, s.coach, sh.goals_for, sh.goals_against) c
  where s.fixture_id = p_fixture and s.minutes > 0;
  update public.fixtures
  set status = 'published', goals_for = sh.goals_for, goals_against = sh.goals_against, published_at = now()
  where id = p_fixture;
  perform private.recalc_scores(f.matchday_id);
end $$;

-- Desa l'acta (esborrany) i, si cal, la publica.
-- p_stats: [{player_id, minutes, goals, assists, yellow, red, coach}, ...]
create function public.admin_save_sheet(p_fixture bigint, p_goals_for int, p_goals_against int, p_stats jsonb, p_publish boolean default false)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  f public.fixtures;
  bad bigint;
begin
  perform private.require_admin();
  select * into f from public.fixtures where id = p_fixture for update;
  if not found then perform private.fail('NOT_FOUND', 'Aquest partit no existeix.'); end if;
  perform private.require_results_open(f.matchday_id);
  if f.status = 'postponed' then perform private.fail('INVALID', 'Aquest partit està ajornat.'); end if;

  select (e ->> 'player_id')::bigint into bad
  from jsonb_array_elements(coalesce(p_stats, '[]')) e
  left join public.players p on p.id = (e ->> 'player_id')::bigint and p.team_id = f.team_id
  where p.id is null limit 1;
  if found then perform private.fail('INVALID', format('El jugador %s no és d''aquest equip.', bad)); end if;

  insert into public.match_sheets (fixture_id, goals_for, goals_against, updated_at)
  values (p_fixture, p_goals_for, p_goals_against, now())
  on conflict (fixture_id) do update set goals_for = excluded.goals_for, goals_against = excluded.goals_against, updated_at = now();

  delete from public.player_stats where fixture_id = p_fixture;
  insert into public.player_stats (fixture_id, player_id, minutes, goals, assists, yellow, red, coach)
  select p_fixture, (e ->> 'player_id')::bigint,
         coalesce((e ->> 'minutes')::int, 0), coalesce((e ->> 'goals')::int, 0), coalesce((e ->> 'assists')::int, 0),
         coalesce((e ->> 'yellow')::int, 0), coalesce((e ->> 'red')::int, 0), coalesce((e ->> 'coach')::int, 0)
  from jsonb_array_elements(coalesce(p_stats, '[]')) e;

  if p_publish then
    perform private.publish_fixture(p_fixture);
  elsif f.status = 'pending' then
    update public.fixtures set status = 'draft' where id = p_fixture;
  end if;
end $$;

create function public.admin_set_postponed(p_fixture bigint, p_postponed boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare f public.fixtures;
begin
  perform private.require_admin();
  select * into f from public.fixtures where id = p_fixture for update;
  if not found then perform private.fail('NOT_FOUND', 'Aquest partit no existeix.'); end if;
  if (select status from public.matchdays where id = f.matchday_id) = 'closed' then
    perform private.fail('CLOSED', 'Aquesta jornada ja està tancada.');
  end if;
  delete from public.player_points where fixture_id = p_fixture;
  update public.fixtures
  set status = case when p_postponed then 'postponed'::public.fixture_status
                    when exists (select 1 from public.match_sheets where fixture_id = p_fixture) then 'draft'
                    else 'pending' end,
      goals_for = null, goals_against = null, published_at = null
  where id = p_fixture;
  perform private.recalc_scores(f.matchday_id);
end $$;

-- Crea els partits de la jornada per a tots els equips. Camp invertit respecte de l'anterior, mateix dia i hora.
create function public.admin_create_fixtures(p_matchday bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare
  md public.matchdays;
  n int;
begin
  perform private.require_admin();
  select * into md from public.matchdays where id = p_matchday;
  if not found then perform private.fail('NOT_FOUND', 'Aquesta jornada no existeix.'); end if;
  if exists (select 1 from public.fixtures where matchday_id = p_matchday) then
    perform private.fail('INVALID', 'Aquesta jornada ja té partits.');
  end if;
  insert into public.fixtures (matchday_id, team_id, rival, is_home, day, kickoff)
  select p_matchday, t.id, '', coalesce(not prev.is_home, true), coalesce(prev.day, 'sat'), prev.kickoff
  from public.teams t
  left join lateral (
    select f.* from public.fixtures f join public.matchdays m on m.id = f.matchday_id
    where f.team_id = t.id and m.season_id = md.season_id and m.number < md.number
    order by m.number desc limit 1
  ) prev on true
  where t.season_id = md.season_id
  order by t.sort, t.id;
  get diagnostics n = row_count;
  return n;
end $$;

-- Tanca la jornada: diners i premis a cada lliga, preus nous i jornada següent.
create function public.admin_close_matchday(p_matchday bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  md public.matchdays;
  pending int;
  n_leagues int;
  next_id bigint;
  sc record;
begin
  perform private.require_admin();
  select * into md from public.matchdays where id = p_matchday for update;
  if not found then perform private.fail('NOT_FOUND', 'Aquesta jornada no existeix.'); end if;
  perform private.require_results_open(p_matchday);
  select count(*) filter (where status not in ('published', 'postponed')) into pending from public.fixtures where matchday_id = p_matchday;
  if pending > 0 then
    perform private.fail('PENDING', format('Falten %s partits.', pending));
  end if;
  if not exists (select 1 from public.fixtures where matchday_id = p_matchday) then
    perform private.fail('PENDING', 'Aquesta jornada no té partits.');
  end if;

  perform private.recalc_scores(p_matchday);

  -- Diners: 0,1M per punt (mai negatiu) + 3/2/1M al podi. Empat: qui va entrar abans.
  with ranked as (
    select s.manager_id, row_number() over (partition by s.league_id order by s.points desc, m.joined_at, m.id) as rk
    from public.manager_scores s join public.managers m on m.id = s.manager_id
    where s.matchday_id = p_matchday
  )
  update public.manager_scores s
  set rank = r.rk,
      points_money = round(greatest(s.points, 0) * 0.1, 1),
      prize = case r.rk when 1 then 3 when 2 then 2 when 3 then 1 else 0 end,
      paid_at = now()
  from ranked r
  where s.manager_id = r.manager_id and s.matchday_id = p_matchday;

  for sc in select * from public.manager_scores where matchday_id = p_matchday loop
    perform private.credit(sc.manager_id, sc.points_money, 'matchday_points', null, p_matchday);
    perform private.credit(sc.manager_id, sc.prize, 'matchday_prize', null, p_matchday);
  end loop;

  -- Preus: rendiment + demanda (proporció de lligues on té propietari).
  select count(*) into n_leagues from public.leagues where season_id = md.season_id;
  with pts as (
    select player_id, sum(points)::int as points from public.player_points where matchday_id = p_matchday group by player_id
  ), owned as (
    select o.player_id, count(*) as c from public.ownership o join public.leagues l on l.id = o.league_id
    where l.season_id = md.season_id group by o.player_id
  ), np as (
    select p.id, p.price as old_price,
           private.next_price(p.price, t.base_price, coalesce(pts.points, 0), coalesce(owned.c::numeric / nullif(n_leagues, 0), 0)) as new_price
    from public.players p
    join public.teams t on t.id = p.team_id and t.season_id = md.season_id
    left join pts on pts.player_id = p.id
    left join owned on owned.player_id = p.id
    where p.active
  ), hist as (
    insert into public.price_history (player_id, matchday_id, price, delta)
    select id, p_matchday, new_price, new_price - old_price from np
    on conflict (player_id, matchday_id) do update set price = excluded.price, delta = excluded.delta
  )
  update public.players p set price = np.new_price from np where p.id = np.id;

  update public.matchdays set status = 'closed', closed_at = now() where id = p_matchday;

  insert into public.matchdays (season_id, number, sat_date)
  values (md.season_id, md.number + 1, md.sat_date + 7)
  on conflict (season_id, number) do nothing;
  select id into next_id from public.matchdays where season_id = md.season_id and number = md.number + 1;
  update public.seasons set current_matchday_id = next_id where id = md.season_id and current_matchday_id = p_matchday;

  return jsonb_build_object('matchday_id', p_matchday, 'next_matchday_id', next_id);
end $$;

-- Jugadors -------------------------------------------------------------------

create function public.admin_save_player(p_id bigint, p_name text, p_team bigint, p_position public.position, p_number int)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint := p_id;
  old public.players;
  o record;
begin
  perform private.require_admin();
  if array_length(regexp_split_to_array(btrim(coalesce(p_name, '')), '\s+'), 1) < 2 then
    perform private.fail('INVALID', 'Cal el nom complet.');
  end if;
  if not exists (select 1 from public.teams where id = p_team) then perform private.fail('INVALID', 'Aquest equip no existeix.'); end if;
  if p_number is not null and p_number not between 0 and 99 then perform private.fail('INVALID', 'El dorsal ha de ser de 0 a 99.'); end if;
  if v_id is null then
    insert into public.players (team_id, name, position, shirt_number, price)
    select p_team, btrim(p_name), p_position, p_number, t.base_price from public.teams t where t.id = p_team
    returning id into v_id;
    return v_id;
  end if;
  select * into old from public.players where id = v_id and active for update;
  if not found then perform private.fail('NOT_FOUND', 'Aquest jugador no existeix.'); end if;
  update public.players set name = btrim(p_name), team_id = p_team, position = p_position, shirt_number = p_number where id = v_id;
  -- Canvi de posició: surt del seu lloc i es torna a col·locar.
  if old.position <> p_position then
    for o in select manager_id from public.ownership where player_id = v_id loop
      perform private.lineup_remove(o.manager_id, v_id);
      perform private.lineup_place(o.manager_id, v_id);
    end loop;
  end if;
  return v_id;
end $$;

-- Baixa: surt de totes les plantilles (el propietari cobra el preu actual) i del mercat.
create function public.admin_remove_player(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.players;
  o record;
begin
  perform private.require_admin();
  select * into p from public.players where id = p_id and active for update;
  if not found then perform private.fail('NOT_FOUND', 'Aquest jugador no existeix.'); end if;
  update public.players set active = false where id = p_id;
  for o in select * from public.ownership where player_id = p_id loop
    perform private.transfer(o.league_id, p_id, o.manager_id, null, 'deal');
    perform private.credit(o.manager_id, p.price, 'player_removed', p_id);
  end loop;
  update public.bids set status = 'withdrawn', resolved_at = now() where player_id = p_id and status = 'active';
  update public.offers set status = 'cancelled', resolved_at = now() where player_id = p_id and status = 'pending';
  update public.trades set status = 'cancelled', resolved_at = now() where status = 'pending' and p_id in (give_player, get_player);
end $$;

-- Importar llista: [{nom, equip (nom curt), posicio, dorsal}]. Si hi ha errors, no s'importa res.
create function public.admin_import_players(p_rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  errs text[] := '{}';
  r record;
  n int;
begin
  perform private.require_admin();
  create temp table _imp on commit drop as
  select e.ord, btrim(e.v ->> 'nom') as nom, btrim(e.v ->> 'equip') as equip, upper(btrim(e.v ->> 'posicio')) as posicio,
         nullif(btrim(e.v ->> 'dorsal'), '') as dorsal, t.id as team_id, t.base_price
  from jsonb_array_elements(coalesce(p_rows, '[]')) with ordinality e(v, ord)
  left join public.teams t on upper(t.short) = upper(btrim(e.v ->> 'equip'))
    and t.season_id = (select id from public.seasons where is_active);
  for r in select * from _imp order by ord loop
    if array_length(regexp_split_to_array(coalesce(r.nom, ''), '\s+'), 1) < 2 or r.nom is null then
      errs := errs || format('Fila %s: cal el nom complet.', r.ord);
    end if;
    if r.team_id is null then errs := errs || format('Fila %s: equip «%s» desconegut.', r.ord, coalesce(r.equip, '')); end if;
    if r.posicio is null or r.posicio not in ('POR', 'DEF', 'MIG', 'DAV') then
      errs := errs || format('Fila %s: posició «%s» (POR, DEF, MIG o DAV).', r.ord, coalesce(r.posicio, ''));
    end if;
    if r.dorsal is not null and (r.dorsal !~ '^\d{1,2}$') then errs := errs || format('Fila %s: dorsal «%s».', r.ord, r.dorsal); end if;
  end loop;
  if cardinality(errs) > 0 then
    raise exception using message = 'No s''ha importat cap jugador. Corregeix la llista.', detail = array_to_string(errs, E'\n'), errcode = 'P0001', hint = 'IMPORT_ERRORS';
  end if;
  insert into public.players (team_id, name, position, shirt_number, price)
  select team_id, nom, posicio::public.position, dorsal::smallint, base_price from _imp order by ord;
  get diagnostics n = row_count;
  return n;
end $$;

-- Tasca programada (cada minut) -------------------------------------------
-- Idempotent: fa el que toqui segons l'hora de Madrid, encara que s'hagi saltat alguna execució.
create function private.tick() returns void
language plpgsql set search_path = '' as $$
declare
  md public.matchdays;
  l record;
begin
  select m.* into md from public.seasons s join public.matchdays m on m.id = s.current_matchday_id where s.is_active;
  if found and md.status = 'upcoming' and private.lock_due(md.id) then
    perform private.lock_matchday(md.id);
  end if;
  for l in
    select distinct league_id from public.bids
    where status = 'active' and private.market_close_after(created_at) <= private.clock()
  loop
    perform private.resolve_bids(l.league_id, private.clock());
  end loop;
  update public.offers set status = 'expired', resolved_at = now() where status = 'pending' and expires_at <= private.clock();
  update public.trades set status = 'expired', resolved_at = now() where status = 'pending' and expires_at <= private.clock();
  if (select market_open from public.market_status()) then
    for l in select lg.id from public.leagues lg join public.seasons s on s.id = lg.season_id and s.is_active loop
      perform private.ensure_listing(l.id);
    end loop;
  end if;
end $$;

-- Perfil automàtic en registrar-se.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(coalesce(new.email, ''), '@', 1)), 60))
  on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();

-- Vistes (amb els permisos de qui consulta) ------------------------------

create view public.league_table with (security_invoker = true) as
select m.league_id, m.id as manager_id, m.team_name, p.display_name, m.joined_at,
       coalesce(sum(s.points), 0)::int as total_points,
       coalesce((
         select s2.points from public.manager_scores s2 join public.matchdays d on d.id = s2.matchday_id
         where s2.manager_id = m.id order by d.number desc limit 1
       ), 0)::int as last_points
from public.managers m
join public.profiles p on p.id = m.user_id
left join public.manager_scores s on s.manager_id = m.id
group by m.id, p.display_name;

create view public.player_season_points with (security_invoker = true) as
select pp.player_id, sum(pp.points)::int as points, count(*)::int as matches
from public.player_points pp
group by pp.player_id;
