-- CE Apa Poble Sec Fantasy · esquema
-- Diners en milions amb un decimal (numeric(7,1)).

create schema if not exists private;
revoke all on schema private from public;

create type public.position as enum ('POR', 'DEF', 'MIG', 'DAV');
create type public.user_role as enum ('player', 'admin');
create type public.matchday_status as enum ('upcoming', 'locked', 'closed');
create type public.fixture_status as enum ('pending', 'draft', 'published', 'postponed');
create type public.match_day as enum ('sat', 'sun');
create type public.bid_status as enum ('active', 'won', 'lost', 'withdrawn');
create type public.proposal_status as enum ('pending', 'accepted', 'rejected', 'cancelled', 'expired');
create type public.acquisition as enum ('deal', 'bid', 'clause', 'offer', 'trade');
create type public.tx_kind as enum (
  'sale', 'bid_won', 'clause_paid', 'clause_received', 'offer_paid', 'offer_received',
  'trade_cash', 'matchday_points', 'matchday_prize', 'player_removed'
);

-- Club ---------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 60),
  role public.user_role not null default 'player',
  created_at timestamptz not null default now()
);

create table public.seasons (
  id bigint generated always as identity primary key,
  name text not null unique,
  max_per_team smallint not null default 3 check (max_per_team between 1 and 6),
  squad_max smallint not null default 18 check (squad_max between 15 and 30),
  is_active boolean not null default false,
  current_matchday_id bigint
);
create unique index seasons_one_active on public.seasons (is_active) where is_active;

create table public.teams (
  id bigint generated always as identity primary key,
  season_id bigint not null references public.seasons on delete cascade,
  name text not null,
  short text not null,
  age smallint not null check (age between 5 and 40),
  format text generated always as (case when age <= 12 then 'F7' else 'F11' end) stored,
  base_price numeric(4,1) generated always as (case when age <= 12 then 6.0 else 8.0 end) stored,
  sort smallint not null default 0,
  unique (season_id, short),
  unique (season_id, name)
);

create table public.players (
  id bigint generated always as identity primary key,
  team_id bigint not null references public.teams,
  name text not null check (char_length(btrim(name)) between 3 and 80),
  position public.position not null,
  shirt_number smallint check (shirt_number between 0 and 99),
  photo_path text,
  price numeric(5,1) not null check (price > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index players_team_idx on public.players (team_id);

create table public.matchdays (
  id bigint generated always as identity primary key,
  season_id bigint not null references public.seasons on delete cascade,
  number smallint not null check (number > 0),
  sat_date date not null check (extract(isodow from sat_date) = 6),
  status public.matchday_status not null default 'upcoming',
  locked_at timestamptz,
  closed_at timestamptz,
  unique (season_id, number)
);
alter table public.seasons add foreign key (current_matchday_id) references public.matchdays;

create table public.fixtures (
  id bigint generated always as identity primary key,
  matchday_id bigint not null references public.matchdays on delete cascade,
  team_id bigint not null references public.teams,
  rival text not null default '',
  is_home boolean not null default true,
  day public.match_day not null default 'sat',
  kickoff time,
  status public.fixture_status not null default 'pending',
  -- Resultat publicat (null fins que es publica).
  goals_for smallint check (goals_for >= 0),
  goals_against smallint check (goals_against >= 0),
  published_at timestamptz,
  unique (matchday_id, team_id)
);

-- Acta en esborrany: només l'admin.
create table public.match_sheets (
  fixture_id bigint primary key references public.fixtures on delete cascade,
  goals_for smallint not null default 0 check (goals_for >= 0),
  goals_against smallint not null default 0 check (goals_against >= 0),
  updated_at timestamptz not null default now()
);

create table public.player_stats (
  fixture_id bigint not null references public.fixtures on delete cascade,
  player_id bigint not null references public.players,
  minutes smallint not null default 0 check (minutes in (0, 1, 2)),
  goals smallint not null default 0 check (goals >= 0),
  assists smallint not null default 0 check (assists >= 0),
  yellow smallint not null default 0 check (yellow in (0, 1)),
  red smallint not null default 0 check (red in (0, 1)),
  coach smallint not null default 0 check (coach between 0 and 3),
  primary key (fixture_id, player_id)
);

-- Punts publicats: el que veuen els mànagers.
create table public.player_points (
  fixture_id bigint not null references public.fixtures on delete cascade,
  player_id bigint not null references public.players,
  matchday_id bigint not null references public.matchdays on delete cascade,
  points smallint not null,
  breakdown jsonb not null default '[]',
  primary key (fixture_id, player_id)
);
create index player_points_md_idx on public.player_points (matchday_id, player_id);
create index player_points_player_idx on public.player_points (player_id);

create table public.price_history (
  player_id bigint not null references public.players on delete cascade,
  matchday_id bigint not null references public.matchdays on delete cascade,
  price numeric(5,1) not null,
  delta numeric(5,1) not null,
  primary key (player_id, matchday_id)
);

-- Lligues ------------------------------------------------------------------

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  season_id bigint not null references public.seasons,
  name text not null check (char_length(btrim(name)) between 2 and 40),
  code text not null unique check (code ~ '^APA-[A-Z0-9]{4}$'),
  max_managers smallint not null check (max_managers in (10, 20, 30, 50)),
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now()
);

create table public.managers (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  team_name text not null check (char_length(btrim(team_name)) between 2 and 30),
  balance numeric(7,1) not null default 0 check (balance >= 0),
  joined_at timestamptz not null default clock_timestamp(),
  unique (league_id, user_id),
  unique (id, league_id)
);
create index managers_user_idx on public.managers (user_id);

create table public.ownership (
  league_id uuid not null references public.leagues on delete cascade,
  player_id bigint not null references public.players,
  manager_id uuid not null,
  acquired_via public.acquisition not null,
  acquired_at timestamptz not null default now(),
  primary key (league_id, player_id),
  foreign key (manager_id, league_id) references public.managers (id, league_id) on delete cascade
);
create index ownership_manager_idx on public.ownership (manager_id);

-- Alineació actual: 15 llocs (1 POR, 2–5 DEF, 6–9 MIG, 10–11 DAV a l'onze; 12–15 suplents POR/DEF/MIG/DAV).
create table public.lineups (
  manager_id uuid primary key references public.managers on delete cascade,
  slots bigint[] not null default array_fill(null::bigint, array[15]) check (cardinality(slots) = 15),
  captain_id bigint,
  updated_at timestamptz not null default now()
);

-- Alineació congelada en bloquejar la jornada (dissabte 09:00). És la que puntua.
create table public.lineup_snapshots (
  manager_id uuid not null references public.managers on delete cascade,
  matchday_id bigint not null references public.matchdays on delete cascade,
  league_id uuid not null references public.leagues on delete cascade,
  slots bigint[] not null check (cardinality(slots) = 15),
  captain_id bigint,
  primary key (manager_id, matchday_id)
);

create table public.manager_scores (
  manager_id uuid not null references public.managers on delete cascade,
  matchday_id bigint not null references public.matchdays on delete cascade,
  league_id uuid not null references public.leagues on delete cascade,
  points integer not null default 0,
  rank smallint,
  points_money numeric(7,1),
  prize numeric(7,1),
  paid_at timestamptz,
  primary key (manager_id, matchday_id)
);
create index manager_scores_league_idx on public.manager_scores (league_id, matchday_id);

-- Els 16 lliures del dia de cada lliga.
create table public.market_listings (
  league_id uuid not null references public.leagues on delete cascade,
  market_date date not null,
  player_id bigint not null references public.players,
  primary key (league_id, market_date, player_id)
);

create table public.bids (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues on delete cascade,
  manager_id uuid not null,
  player_id bigint not null references public.players,
  amount numeric(7,1) not null check (amount > 0),
  status public.bid_status not null default 'active',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  foreign key (manager_id, league_id) references public.managers (id, league_id) on delete cascade
);
create unique index bids_one_active on public.bids (manager_id, player_id) where status = 'active';
create index bids_league_active on public.bids (league_id) where status = 'active';

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues on delete cascade,
  from_manager uuid not null,
  to_manager uuid not null,
  player_id bigint not null references public.players,
  amount numeric(7,1) not null check (amount > 0),
  status public.proposal_status not null default 'pending',
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  check (from_manager <> to_manager),
  foreign key (from_manager, league_id) references public.managers (id, league_id) on delete cascade,
  foreign key (to_manager, league_id) references public.managers (id, league_id) on delete cascade
);
create unique index offers_one_pending on public.offers (from_manager, player_id) where status = 'pending';

create table public.trades (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues on delete cascade,
  from_manager uuid not null,
  to_manager uuid not null,
  give_player bigint not null references public.players,
  get_player bigint not null references public.players,
  -- Positiu: paga qui proposa. Negatiu: paga qui rep la proposta.
  cash numeric(7,1) not null default 0,
  status public.proposal_status not null default 'pending',
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  check (from_manager <> to_manager),
  foreign key (from_manager, league_id) references public.managers (id, league_id) on delete cascade,
  foreign key (to_manager, league_id) references public.managers (id, league_id) on delete cascade
);

create table public.transactions (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues on delete cascade,
  manager_id uuid not null references public.managers on delete cascade,
  kind public.tx_kind not null,
  amount numeric(7,1) not null,
  player_id bigint references public.players,
  matchday_id bigint references public.matchdays,
  ref_id uuid,
  created_at timestamptz not null default clock_timestamp()
);
create index transactions_manager_idx on public.transactions (manager_id, created_at desc);
