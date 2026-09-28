-- Regles compartides amb packages/core (mateixos casos de prova a packages/db).

-- Rellotge. Als tests es pot fixar amb `set apa.now` si la base de dades ho permet (apa.fake_clock = on).
create function private.clock() returns timestamptz
language sql stable set search_path = '' as $$
  select case
    when current_setting('apa.fake_clock', true) = 'on' and nullif(current_setting('apa.now', true), '') is not null
      then current_setting('apa.now', true)::timestamptz
    else now()
  end
$$;

create function private.fail(p_code text, p_message text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using message = p_message, detail = p_code, errcode = 'P0001';
end $$;

-- 6,0M · 12,5M
create function private.fmt(p numeric) returns text
language sql immutable set search_path = '' as $$
  select replace(to_char(round(p, 1), 'FM9999990.0'), '.', ',') || 'M'
$$;

-- Tancament del mercat de la setmana de `ts`: dissabte 00:00 (hora de Madrid).
create function private.market_close_after(ts timestamptz) returns timestamptz
language sql stable set search_path = '' as $$
  select (date_trunc('week', ts at time zone 'Europe/Madrid') + interval '5 days') at time zone 'Europe/Madrid'
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

create function public.is_league_member(p_league uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.managers where league_id = p_league and user_id = auth.uid())
$$;

create function public.is_my_manager(p_manager uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.managers where id = p_manager and user_id = auth.uid())
$$;

-- Mànager de l'usuari actual (o error).
create function private.my_manager(p_manager uuid) returns public.managers
language plpgsql stable set search_path = '' as $$
declare m public.managers;
begin
  select * into m from public.managers where id = p_manager and user_id = auth.uid();
  if not found then perform private.fail('NOT_MEMBER', 'No ets mànager d''aquesta lliga.'); end if;
  return m;
end $$;

create function private.require_admin() returns void
language plpgsql stable set search_path = '' as $$
begin
  if not public.is_admin() then perform private.fail('FORBIDDEN', 'Només per a administradors del club.'); end if;
end $$;

-- Estat del mercat --------------------------------------------------------

create function private.active_season() returns public.seasons
language sql stable set search_path = '' as $$
  select * from public.seasons where is_active
$$;

-- Ja ha arribat el bloqueig (dissabte 09:00) de la jornada?
create function private.lock_due(p_matchday bigint) returns boolean
language sql stable set search_path = '' as $$
  select (private.clock() at time zone 'Europe/Madrid') >= (m.sat_date + time '09:00')
  from public.matchdays m where m.id = p_matchday
$$;

/*
  Calendari (hora de Madrid), igual que marketPhase() de core:
  - Dl–dv: obert i alineació lliure si la jornada en curs encara no ha començat (status = upcoming).
    Mentre l'admin no tanqui l'anterior, la jornada en curs continua sent l'anterior (locked) → tot tancat.
  - Dissabte 00:00–08:59: mercat tancat, alineació lliure.
  - Dissabte 09:00 – diumenge: tot tancat.
*/
create function public.market_status()
returns table (market_open boolean, lineup_locked boolean, matchday_id bigint, matchday_number smallint, market_date date)
language plpgsql stable security definer set search_path = '' as $$
declare
  md public.matchdays;
  local_ts timestamp := private.clock() at time zone 'Europe/Madrid';
  dow int := extract(isodow from local_ts);
  due boolean;
begin
  select m.* into md from public.seasons s join public.matchdays m on m.id = s.current_matchday_id where s.is_active;
  if not found then
    return query select false, true, null::bigint, null::smallint, local_ts::date;
    return;
  end if;
  due := local_ts >= md.sat_date + time '09:00';
  market_open := md.status = 'upcoming' and dow between 1 and 5 and not due;
  lineup_locked := md.status <> 'upcoming' or due or dow = 7 or (dow = 6 and extract(hour from local_ts) >= 9);
  matchday_id := md.id;
  matchday_number := md.number;
  market_date := local_ts::date;
  return next;
end $$;

create function private.require_market_open() returns void
language plpgsql stable set search_path = '' as $$
begin
  if not (select market_open from public.market_status()) then
    perform private.fail('MARKET_CLOSED', 'El mercat és tancat fins dilluns.');
  end if;
end $$;

-- Puntuació (mirall de playerPoints() a core) ----------------------------

create function private.calc_points(
  p_pos public.position, p_minutes int, p_goals int, p_assists int, p_yellow int, p_red int, p_coach int,
  p_gf int, p_ga int, out points int, out breakdown jsonb
)
language plpgsql immutable set search_path = '' as $$
declare
  gv int := case p_pos when 'POR' then 6 when 'DEF' then 6 when 'MIG' then 5 else 4 end;
  csv int := case p_pos when 'POR' then 4 when 'DEF' then 4 when 'MIG' then 1 else 0 end;
  b jsonb := '[]';
begin
  if p_minutes = 0 then
    points := 0; breakdown := b; return;
  end if;
  b := b || jsonb_build_object('key', 'minutes', 'label', 'Minuts', 'points', p_minutes);
  if p_goals > 0 then
    b := b || jsonb_build_object('key', 'goals', 'label', 'Gols ×' || p_goals, 'points', p_goals * gv);
  end if;
  if p_assists > 0 then
    b := b || jsonb_build_object('key', 'assists', 'label', case when p_assists > 1 then 'Assistències ×' || p_assists else 'Assistència' end, 'points', p_assists * 3);
  end if;
  if p_ga = 0 and p_minutes = 2 and csv > 0 then
    b := b || jsonb_build_object('key', 'cleanSheet', 'label', 'Porteria a zero', 'points', csv);
  end if;
  if p_gf > p_ga then
    b := b || jsonb_build_object('key', 'win', 'label', 'Victòria', 'points', 2);
  elsif p_gf = p_ga then
    b := b || jsonb_build_object('key', 'draw', 'label', 'Empat', 'points', 1);
  end if;
  if p_yellow = 1 then b := b || jsonb_build_object('key', 'yellow', 'label', 'Groga', 'points', -1); end if;
  if p_red = 1 then b := b || jsonb_build_object('key', 'red', 'label', 'Vermella', 'points', -3); end if;
  b := b || jsonb_build_object('key', 'coach', 'label', 'Entrenador', 'points', p_coach);
  select coalesce(sum((e ->> 'points')::int), 0) into points from jsonb_array_elements(b) e;
  breakdown := b;
end $$;

-- Preu en tancar la jornada (mirall de nextPrice() a core).
create function private.next_price(p_price numeric, p_base numeric, p_points int, p_owned_ratio numeric) returns numeric
language sql immutable set search_path = '' as $$
  select greatest(
    p_base - 1,
    round(p_price + (p_points - 5) * 0.05 + 0.3 * least(1, greatest(0, round(coalesce(p_owned_ratio, 0), 2))) - 0.1, 1)
  )
$$;

-- Plantilla i alineació ---------------------------------------------------

-- Llocs de cada posició: primer els de l'onze, després el de la banqueta.
create function private.slot_indexes(p_pos public.position) returns int[]
language sql immutable set search_path = '' as $$
  select case p_pos
    when 'POR' then array[1, 12]
    when 'DEF' then array[2, 3, 4, 5, 13]
    when 'MIG' then array[6, 7, 8, 9, 14]
    else array[10, 11, 15]
  end
$$;

create function private.slot_position(p_index int) returns public.position
language sql immutable set search_path = '' as $$
  select case
    when p_index in (1, 12) then 'POR'
    when p_index between 2 and 5 or p_index = 13 then 'DEF'
    when p_index between 6 and 9 or p_index = 14 then 'MIG'
    else 'DAV'
  end::public.position
$$;

create function private.limits(p_league uuid, out squad_max int, out max_per_team int)
language sql stable set search_path = '' as $$
  select s.squad_max, s.max_per_team from public.leagues l join public.seasons s on s.id = l.season_id where l.id = p_league
$$;

-- Es pot afegir el jugador? (mirall de canAdd() a core). `p_outgoing` surt a la vegada (intercanvis).
create function private.check_can_add(p_manager uuid, p_player bigint, p_outgoing bigint default null) returns void
language plpgsql stable set search_path = '' as $$
declare
  lim record;
  n int;
  n_team int;
  p record;
begin
  select l.* into lim from public.managers m, private.limits(m.league_id) l where m.id = p_manager;
  select pl.team_id, t.name as team_name into p from public.players pl join public.teams t on t.id = pl.team_id where pl.id = p_player;
  select count(*), count(*) filter (where pl.team_id = p.team_id) into n, n_team
  from public.ownership o join public.players pl on pl.id = o.player_id
  where o.manager_id = p_manager and o.player_id is distinct from p_outgoing;
  if n + 1 > lim.squad_max then
    perform private.fail('SQUAD_FULL', format('Plantilla plena (%s). Ven un jugador abans.', lim.squad_max));
  end if;
  if n_team + 1 > lim.max_per_team then
    perform private.fail('TEAM_LIMIT', format('Ja tens %s jugadors del %s.', lim.max_per_team, p.team_name));
  end if;
end $$;

-- Saldo menys les pujes actives (opcionalment sense la puja per `p_except_player`).
create function private.available_balance(p_manager uuid, p_except_player bigint default null) returns numeric
language sql stable set search_path = '' as $$
  select m.balance - coalesce((
    select sum(b.amount) from public.bids b
    where b.manager_id = m.id and b.status = 'active' and b.player_id is distinct from p_except_player
  ), 0)
  from public.managers m where m.id = p_manager
$$;

create function private.require_balance(p_available numeric, p_needed numeric) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_available < p_needed then
    perform private.fail('INSUFFICIENT_BALANCE', format('Saldo insuficient (%s).', private.fmt(p_needed)));
  end if;
end $$;

-- Moviment de diners amb el seu registre.
create function private.credit(
  p_manager uuid, p_amount numeric, p_kind public.tx_kind,
  p_player bigint default null, p_matchday bigint default null, p_ref uuid default null
) returns void
language plpgsql set search_path = '' as $$
begin
  if p_amount = 0 then return; end if;
  update public.managers set balance = balance + p_amount where id = p_manager;
  insert into public.transactions (league_id, manager_id, kind, amount, player_id, matchday_id, ref_id)
  select league_id, id, p_kind, p_amount, p_player, p_matchday, p_ref from public.managers where id = p_manager;
end $$;

-- Treu un jugador de l'alineació; si era el capità, sense capità.
create function private.lineup_remove(p_manager uuid, p_player bigint) returns void
language sql set search_path = '' as $$
  update public.lineups
  set slots = array_replace(slots, p_player, null),
      captain_id = nullif(captain_id, p_player),
      updated_at = now()
  where manager_id = p_manager
$$;

-- Col·loca un jugador nou: primer lloc buit de l'onze, si no de la banqueta; si no, a la reserva.
create function private.lineup_place(p_manager uuid, p_player bigint) returns void
language plpgsql set search_path = '' as $$
declare
  s bigint[];
  i int;
begin
  select slots into s from public.lineups where manager_id = p_manager for update;
  if not found then
    insert into public.lineups (manager_id) values (p_manager);
    s := array_fill(null::bigint, array[15]);
  end if;
  foreach i in array private.slot_indexes((select position from public.players where id = p_player)) loop
    if s[i] is null then
      s[i] := p_player;
      update public.lineups set slots = s, updated_at = now() where manager_id = p_manager;
      return;
    end if;
  end loop;
end $$;

-- Canvi de propietari dins d'una lliga (null = lliure). Cancel·la ofertes i intercanvis que ja no tenen sentit.
create function private.transfer(p_league uuid, p_player bigint, p_from uuid, p_to uuid, p_via public.acquisition) returns void
language plpgsql set search_path = '' as $$
begin
  if p_from is not null then
    delete from public.ownership where league_id = p_league and player_id = p_player and manager_id = p_from;
    if not found then perform private.fail('NOT_OWNER', 'Aquest jugador no és teu.'); end if;
    perform private.lineup_remove(p_from, p_player);
  end if;
  if p_to is not null then
    insert into public.ownership (league_id, player_id, manager_id, acquired_via) values (p_league, p_player, p_to, p_via);
    perform private.lineup_place(p_to, p_player);
  end if;
  update public.offers set status = 'cancelled', resolved_at = now()
  where league_id = p_league and player_id = p_player and status = 'pending';
  update public.trades set status = 'cancelled', resolved_at = now()
  where league_id = p_league and status = 'pending' and p_player in (give_player, get_player);
end $$;

-- Serialitza les operacions de mercat d'una lliga.
create function private.lock_league(p_league uuid) returns void
language sql set search_path = '' as $$
  select 1 from public.leagues where id = p_league for update
$$;
