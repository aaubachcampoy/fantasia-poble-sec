-- RPC dels mànagers. Totes validen amb les regles de core i serialitzen per lliga.

-- Repartiment inicial -------------------------------------------------------

-- 15 jugadors a l'atzar (2 POR, 5 DEF, 5 MIG, 3 DAV) entre els lliures, amb el límit per equip.
-- Onze i banqueta pels més cars; capità el més car de l'onze.
create function private.deal(p_manager uuid) returns void
language plpgsql set search_path = '' as $$
declare
  m public.managers;
  lim record;
  need constant jsonb := '{"POR": 2, "DEF": 5, "MIG": 5, "DAV": 3}';
  pos public.position;
  picked bigint[];
  picked_teams bigint[];
  got int;
  ok boolean;
  r record;
  attempt int;
begin
  select * into m from public.managers where id = p_manager;
  select * into lim from private.limits(m.league_id);
  for attempt in 1..20 loop
    picked := '{}';
    picked_teams := '{}';
    ok := true;
    foreach pos in array array['POR', 'DEF', 'MIG', 'DAV']::public.position[] loop
      got := 0;
      for r in
        select p.id, p.team_id from public.players p
        join public.teams t on t.id = p.team_id
        join public.leagues l on l.season_id = t.season_id and l.id = m.league_id
        where p.active and p.position = pos
          and not exists (select 1 from public.ownership o where o.league_id = m.league_id and o.player_id = p.id)
        order by random()
      loop
        exit when got = (need ->> pos::text)::int;
        if coalesce(cardinality(array_positions(picked_teams, r.team_id)), 0) < lim.max_per_team then
          picked := picked || r.id;
          picked_teams := picked_teams || r.team_id;
          got := got + 1;
        end if;
      end loop;
      if got < (need ->> pos::text)::int then ok := false; exit; end if;
    end loop;
    exit when ok;
  end loop;
  if not ok then
    perform private.fail('NO_PLAYERS', 'No queden prou jugadors lliures en aquesta lliga.');
  end if;

  insert into public.ownership (league_id, player_id, manager_id, acquired_via)
  select m.league_id, unnest(picked), p_manager, 'deal';
  insert into public.lineups (manager_id) values (p_manager);
  perform private.lineup_place(p_manager, p.id)
  from public.players p where p.id = any (picked) order by p.price desc, p.id;
  update public.lineups l set captain_id = (
    select p.id from public.players p where p.id = any (l.slots[1:11]) order by p.price desc, p.id limit 1
  ) where l.manager_id = p_manager;
end $$;

create function private.new_league_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := 'APA-' || (select string_agg(substr(alphabet, 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 4));
    exit when not exists (select 1 from public.leagues where code = c);
  end loop;
  return c;
end $$;

create function private.add_manager(p_league uuid, p_team_name text) returns uuid
language plpgsql set search_path = '' as $$
declare
  l public.leagues;
  mid uuid;
begin
  select * into l from public.leagues where id = p_league for update;
  if exists (select 1 from public.managers where league_id = p_league and user_id = auth.uid()) then
    perform private.fail('ALREADY_MEMBER', 'Ja ets en aquesta lliga.');
  end if;
  if (select count(*) from public.managers where league_id = p_league) >= l.max_managers then
    perform private.fail('LEAGUE_FULL', 'Aquesta lliga ja és plena.');
  end if;
  if char_length(btrim(coalesce(p_team_name, ''))) < 2 then
    perform private.fail('INVALID', 'Cal el nom del teu equip.');
  end if;
  insert into public.managers (league_id, user_id, team_name) values (p_league, auth.uid(), btrim(p_team_name)) returning id into mid;
  perform private.deal(mid);
  return mid;
end $$;

create function public.create_league(p_name text, p_team_name text, p_max_managers int)
returns table (league_id uuid, code text, manager_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  s public.seasons := private.active_season();
begin
  if auth.uid() is null then perform private.fail('AUTH', 'Cal iniciar sessió.'); end if;
  if s.id is null then perform private.fail('NO_SEASON', 'No hi ha cap temporada activa.'); end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then perform private.fail('INVALID', 'Cal el nom de la lliga.'); end if;
  if p_max_managers not in (10, 20, 30, 50) then perform private.fail('INVALID', 'Màxim de participants: 10, 20, 30 o 50.'); end if;
  insert into public.leagues (season_id, name, code, max_managers, created_by)
  values (s.id, btrim(p_name), private.new_league_code(), p_max_managers, auth.uid())
  returning leagues.id, leagues.code into league_id, code;
  manager_id := private.add_manager(league_id, p_team_name);
  return next;
end $$;

create function public.join_league(p_code text, p_team_name text)
returns table (league_id uuid, manager_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform private.fail('AUTH', 'Cal iniciar sessió.'); end if;
  select l.id into league_id from public.leagues l
  join public.seasons s on s.id = l.season_id and s.is_active
  where l.code = upper(btrim(coalesce(p_code, '')));
  if league_id is null then perform private.fail('BAD_CODE', 'No hi ha cap lliga amb aquest codi.'); end if;
  manager_id := private.add_manager(league_id, p_team_name);
  return next;
end $$;

-- Alineació ----------------------------------------------------------------

create function public.set_lineup(p_manager uuid, p_slots bigint[], p_captain bigint)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.managers := private.my_manager(p_manager);
  i int;
  p record;
begin
  if (select lineup_locked from public.market_status()) then
    perform private.fail('LINEUP_LOCKED', 'Alineació bloquejada durant la jornada.');
  end if;
  if coalesce(cardinality(p_slots), 0) <> 15 then
    perform private.fail('INVALID', 'L''alineació no té la forma 4-4-2 + 4 suplents.');
  end if;
  for i in 1..15 loop
    continue when p_slots[i] is null;
    select pl.position into p from public.ownership o join public.players pl on pl.id = o.player_id
    where o.manager_id = m.id and o.player_id = p_slots[i];
    if not found then perform private.fail('NOT_OWNER', 'Aquest jugador no és teu.'); end if;
    if p.position <> private.slot_position(i) then perform private.fail('INVALID', 'Jugador fora de la seva posició.'); end if;
    if cardinality(array_positions(p_slots, p_slots[i])) > 1 then perform private.fail('INVALID', 'Jugador repetit a l’alineació.'); end if;
  end loop;
  -- array_position i no `= any`: amb llocs buits (null) `= any` retorna null i no false.
  if p_captain is not null and array_position(p_slots[1:11], p_captain) is null then
    perform private.fail('INVALID', 'El capità ha de ser a l''onze.');
  end if;
  update public.lineups set slots = p_slots, captain_id = p_captain, updated_at = now() where manager_id = m.id;
end $$;

-- Mercat -------------------------------------------------------------------

-- Els 16 lliures del dia (els genera si encara no hi són).
create function private.ensure_listing(p_league uuid) returns date
language plpgsql set search_path = '' as $$
declare
  d date := (select market_date from public.market_status());
begin
  if not exists (select 1 from public.market_listings where league_id = p_league and market_date = d) then
    insert into public.market_listings (league_id, market_date, player_id)
    select p_league, d, p.id from public.players p
    join public.teams t on t.id = p.team_id
    join public.leagues l on l.season_id = t.season_id and l.id = p_league
    where p.active and not exists (select 1 from public.ownership o where o.league_id = p_league and o.player_id = p.id)
    order by random() limit 16
    on conflict do nothing;
  end if;
  return d;
end $$;

create function public.market_listing(p_manager uuid) returns setof bigint
language plpgsql security definer set search_path = '' as $$
declare
  m public.managers := private.my_manager(p_manager);
  d date;
begin
  if (select market_open from public.market_status()) then
    d := private.ensure_listing(m.league_id);
  else
    -- Mercat tancat: es mostren els de l'últim dia.
    select max(market_date) into d from public.market_listings where league_id = m.league_id;
  end if;
  return query
    select ml.player_id from public.market_listings ml
    join public.players p on p.id = ml.player_id and p.active
    where ml.league_id = m.league_id and ml.market_date = d
      and not exists (select 1 from public.ownership o where o.league_id = m.league_id and o.player_id = ml.player_id);
end $$;

create function public.sell_player(p_manager uuid, p_player bigint) returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  m public.managers := private.my_manager(p_manager);
  v_price numeric;
begin
  perform private.require_market_open();
  perform private.lock_league(m.league_id);
  select p.price into v_price from public.players p where p.id = p_player;
  perform private.transfer(m.league_id, p_player, m.id, null, 'deal');
  perform private.credit(m.id, v_price, 'sale', p_player);
  return v_price;
end $$;

create function public.pay_clause(p_manager uuid, p_player bigint) returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  m public.managers := private.my_manager(p_manager);
  seller uuid;
  clause numeric;
begin
  perform private.require_market_open();
  perform private.lock_league(m.league_id);
  select o.manager_id into seller from public.ownership o where o.league_id = m.league_id and o.player_id = p_player;
  if seller is null then perform private.fail('INVALID', 'Aquest jugador és lliure: fes-hi una puja.'); end if;
  if seller = m.id then perform private.fail('INVALID', 'Aquest jugador ja és teu.'); end if;
  select round(p.price * 1.5, 1) into clause from public.players p where p.id = p_player;
  perform private.check_can_add(m.id, p_player);
  perform private.require_balance(private.available_balance(m.id), clause);
  perform private.transfer(m.league_id, p_player, seller, m.id, 'clause');
  perform private.credit(m.id, -clause, 'clause_paid', p_player);
  perform private.credit(seller, clause, 'clause_received', p_player);
  return clause;
end $$;

-- Puja secreta nova o modificada.
create function public.place_bid(p_manager uuid, p_player bigint, p_amount numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.managers := private.my_manager(p_manager);
  v_amount numeric := round(p_amount, 1);
  v_price numeric;
  has_bid boolean;
  d date;
begin
  perform private.require_market_open();
  perform private.lock_league(m.league_id);
  if exists (select 1 from public.ownership where league_id = m.league_id and player_id = p_player) then
    perform private.fail('ALREADY_OWNED', 'Aquest jugador ja té propietari.');
  end if;
  has_bid := exists (select 1 from public.bids where manager_id = m.id and player_id = p_player and status = 'active');
  if not has_bid then
    d := private.ensure_listing(m.league_id);
    if not exists (select 1 from public.market_listings where league_id = m.league_id and market_date = d and player_id = p_player) then
      perform private.fail('NOT_LISTED', 'Aquest jugador no és al mercat avui.');
    end if;
  end if;
  select p.price into v_price from public.players p where p.id = p_player and p.active;
  if v_price is null then perform private.fail('INVALID', 'Aquest jugador ja no és al club.'); end if;
  if v_amount < v_price then
    perform private.fail('BID_BELOW_PRICE', format('La puja ha de ser com a mínim de %s.', private.fmt(v_price)));
  end if;
  perform private.check_can_add(m.id, p_player);
  perform private.require_balance(private.available_balance(m.id, p_player), v_amount);
  if has_bid then
    update public.bids set amount = v_amount, updated_at = clock_timestamp()
    where manager_id = m.id and player_id = p_player and status = 'active';
  else
    insert into public.bids (league_id, manager_id, player_id, amount) values (m.league_id, m.id, p_player, v_amount);
  end if;
end $$;

create function public.withdraw_bid(p_manager uuid, p_player bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.managers := private.my_manager(p_manager);
begin
  perform private.require_market_open();
  update public.bids set status = 'withdrawn', resolved_at = now()
  where manager_id = m.id and player_id = p_player and status = 'active';
end $$;

-- Quantes pujes més hi ha pels jugadors on he pujat (no es veu l'import).
create function public.my_bid_rivals(p_manager uuid) returns table (player_id bigint, rivals int)
language plpgsql security definer set search_path = '' as $$
declare
  m public.managers := private.my_manager(p_manager);
begin
  return query
    select b.player_id, (select count(*)::int from public.bids o where o.league_id = b.league_id and o.player_id = b.player_id and o.status = 'active' and o.manager_id <> b.manager_id)
    from public.bids b where b.manager_id = m.id and b.status = 'active';
end $$;

-- Resolució al tancament del mercat (mirall de resolveBids() a core).
create function private.resolve_bids(p_league uuid, p_cutoff timestamptz) returns void
language plpgsql set search_path = '' as $$
declare
  b record;
  awarded bigint[] := '{}';
  reason text;
begin
  perform private.lock_league(p_league);
  for b in
    select * from public.bids
    where league_id = p_league and status = 'active' and private.market_close_after(created_at) <= p_cutoff
    order by amount desc, created_at, id
  loop
    reason := null;
    if b.player_id = any (awarded)
      or exists (select 1 from public.ownership where league_id = p_league and player_id = b.player_id)
      or not exists (select 1 from public.players where id = b.player_id and active) then
      reason := 'OUTBID';
    elsif (select balance from public.managers where id = b.manager_id) < b.amount then
      reason := 'INSUFFICIENT_BALANCE';
    else
      begin
        perform private.check_can_add(b.manager_id, b.player_id);
      exception when sqlstate 'P0001' then
        reason := 'LIMIT';
      end;
    end if;
    if reason is null then
      perform private.transfer(p_league, b.player_id, null, b.manager_id, 'bid');
      perform private.credit(b.manager_id, -b.amount, 'bid_won', b.player_id, null, b.id);
      awarded := awarded || b.player_id;
      update public.bids set status = 'won', resolved_at = now() where id = b.id;
    else
      update public.bids set status = 'lost', resolved_at = now() where id = b.id;
    end if;
  end loop;
end $$;

-- Ofertes de compra -----------------------------------------------------------

create function public.make_offer(p_manager uuid, p_player bigint, p_amount numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m public.managers := private.my_manager(p_manager);
  v_amount numeric := round(p_amount, 1);
  owner uuid;
  oid uuid;
begin
  perform private.require_market_open();
  perform private.lock_league(m.league_id);
  if not (v_amount > 0) then perform private.fail('INVALID', 'L''oferta ha de ser més gran que 0.'); end if;
  select o.manager_id into owner from public.ownership o where o.league_id = m.league_id and o.player_id = p_player;
  if owner is null then perform private.fail('INVALID', 'Aquest jugador és lliure: fes-hi una puja.'); end if;
  if owner = m.id then perform private.fail('INVALID', 'Aquest jugador ja és teu.'); end if;
  perform private.check_can_add(m.id, p_player);
  perform private.require_balance(private.available_balance(m.id), v_amount);
  update public.offers set status = 'cancelled', resolved_at = now()
  where from_manager = m.id and player_id = p_player and status = 'pending';
  insert into public.offers (league_id, from_manager, to_manager, player_id, amount, expires_at)
  values (m.league_id, m.id, owner, p_player, v_amount, private.market_close_after(private.clock()))
  returning id into oid;
  return oid;
end $$;

create function public.respond_offer(p_offer uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  o public.offers;
begin
  select * into o from public.offers where id = p_offer;
  if not found or not public.is_my_manager(o.to_manager) then perform private.fail('NOT_FOUND', 'Aquesta oferta no existeix.'); end if;
  perform private.lock_league(o.league_id);
  select * into o from public.offers where id = p_offer;
  if o.status <> 'pending' then perform private.fail('INVALID', 'Aquesta oferta ja no és vigent.'); end if;
  if not p_accept then
    update public.offers set status = 'rejected', resolved_at = now() where id = o.id;
    return;
  end if;
  perform private.require_market_open();
  perform private.check_can_add(o.from_manager, o.player_id);
  perform private.require_balance(private.available_balance(o.from_manager), o.amount);
  perform private.transfer(o.league_id, o.player_id, o.to_manager, o.from_manager, 'offer');
  perform private.credit(o.from_manager, -o.amount, 'offer_paid', o.player_id, null, o.id);
  perform private.credit(o.to_manager, o.amount, 'offer_received', o.player_id, null, o.id);
  update public.offers set status = 'accepted', resolved_at = now() where id = o.id;
end $$;

create function public.cancel_offer(p_offer uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.offers set status = 'cancelled', resolved_at = now()
  where id = p_offer and status = 'pending' and public.is_my_manager(from_manager);
  if not found then perform private.fail('NOT_FOUND', 'Aquesta oferta no existeix.'); end if;
end $$;

-- Intercanvis 1×1 ---------------------------------------------------------

create function private.check_trade(t public.trades) returns void
language plpgsql stable set search_path = '' as $$
begin
  if not exists (select 1 from public.ownership where league_id = t.league_id and player_id = t.give_player and manager_id = t.from_manager) then
    perform private.fail('NOT_OWNER', 'Aquest jugador no és teu.');
  end if;
  if not exists (select 1 from public.ownership where league_id = t.league_id and player_id = t.get_player and manager_id = t.to_manager) then
    perform private.fail('INVALID', 'El jugador ja no és del rival.');
  end if;
  perform private.check_can_add(t.from_manager, t.get_player, t.give_player);
  perform private.check_can_add(t.to_manager, t.give_player, t.get_player);
  if t.cash > 0 then perform private.require_balance(private.available_balance(t.from_manager), t.cash); end if;
  if t.cash < 0 then perform private.require_balance(private.available_balance(t.to_manager), -t.cash); end if;
end $$;

create function public.propose_trade(p_manager uuid, p_to_manager uuid, p_give bigint, p_get bigint, p_cash numeric default 0) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m public.managers := private.my_manager(p_manager);
  t public.trades;
begin
  perform private.require_market_open();
  perform private.lock_league(m.league_id);
  if not exists (select 1 from public.managers where id = p_to_manager and league_id = m.league_id) or p_to_manager = m.id then
    perform private.fail('INVALID', 'Tria un rival de la teva lliga.');
  end if;
  t.league_id := m.league_id;
  t.from_manager := m.id;
  t.to_manager := p_to_manager;
  t.give_player := p_give;
  t.get_player := p_get;
  t.cash := round(coalesce(p_cash, 0), 1);
  perform private.check_trade(t);
  insert into public.trades (league_id, from_manager, to_manager, give_player, get_player, cash, expires_at)
  values (t.league_id, t.from_manager, t.to_manager, t.give_player, t.get_player, t.cash, private.market_close_after(private.clock()))
  returning id into t.id;
  return t.id;
end $$;

create function public.respond_trade(p_trade uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.trades;
begin
  select * into t from public.trades where id = p_trade;
  if not found or not public.is_my_manager(t.to_manager) then perform private.fail('NOT_FOUND', 'Aquesta proposta no existeix.'); end if;
  perform private.lock_league(t.league_id);
  select * into t from public.trades where id = p_trade;
  if t.status <> 'pending' then perform private.fail('INVALID', 'Aquesta proposta ja no és vigent.'); end if;
  if not p_accept then
    update public.trades set status = 'rejected', resolved_at = now() where id = t.id;
    return;
  end if;
  perform private.require_market_open();
  perform private.check_trade(t);
  -- Marca-la abans: transfer() cancel·la les propostes pendents amb aquests jugadors.
  update public.trades set status = 'accepted', resolved_at = now() where id = t.id;
  delete from public.ownership where league_id = t.league_id and player_id in (t.give_player, t.get_player);
  perform private.lineup_remove(t.from_manager, t.give_player);
  perform private.lineup_remove(t.to_manager, t.get_player);
  perform private.transfer(t.league_id, t.get_player, null, t.from_manager, 'trade');
  perform private.transfer(t.league_id, t.give_player, null, t.to_manager, 'trade');
  if t.cash <> 0 then
    perform private.credit(t.from_manager, -t.cash, 'trade_cash', null, null, t.id);
    perform private.credit(t.to_manager, t.cash, 'trade_cash', null, null, t.id);
  end if;
end $$;

create function public.cancel_trade(p_trade uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.trades set status = 'cancelled', resolved_at = now()
  where id = p_trade and status = 'pending' and public.is_my_manager(from_manager);
  if not found then perform private.fail('NOT_FOUND', 'Aquesta proposta no existeix.'); end if;
end $$;
