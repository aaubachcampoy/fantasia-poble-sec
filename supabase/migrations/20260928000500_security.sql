-- RLS i permisos. Les escriptures de les lligues només passen per RPC.

alter table public.profiles enable row level security;
alter table public.seasons enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.matchdays enable row level security;
alter table public.fixtures enable row level security;
alter table public.match_sheets enable row level security;
alter table public.player_stats enable row level security;
alter table public.player_points enable row level security;
alter table public.price_history enable row level security;
alter table public.leagues enable row level security;
alter table public.managers enable row level security;
alter table public.ownership enable row level security;
alter table public.lineups enable row level security;
alter table public.lineup_snapshots enable row level security;
alter table public.manager_scores enable row level security;
alter table public.market_listings enable row level security;
alter table public.bids enable row level security;
alter table public.offers enable row level security;
alter table public.trades enable row level security;
alter table public.transactions enable row level security;

-- Anònims: res.
revoke all on all tables in schema public from anon;
-- Autenticats: lectura (filtrada per RLS); les escriptures s'obren taula a taula.
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;

-- Perfils: tothom veu els noms; cadascú només canvia el seu nom (el rol, mai).
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
grant update (display_name) on public.profiles to authenticated;

-- Dades del club: lectura per a tothom; escriptura directa de l'admin (la resta, per RPC).
create policy seasons_read on public.seasons for select to authenticated using (true);
create policy teams_read on public.teams for select to authenticated using (true);
create policy players_read on public.players for select to authenticated using (true);
create policy matchdays_read on public.matchdays for select to authenticated using (true);
create policy fixtures_read on public.fixtures for select to authenticated using (true);
create policy player_points_read on public.player_points for select to authenticated using (true);
create policy price_history_read on public.price_history for select to authenticated using (true);

create policy teams_admin on public.teams for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant update (name, short, age, sort) on public.teams to authenticated;
create policy players_admin on public.players for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant update (name, shirt_number, photo_path) on public.players to authenticated;
create policy fixtures_admin on public.fixtures for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant update (rival, is_home, day, kickoff) on public.fixtures to authenticated;
create policy seasons_admin on public.seasons for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant update (max_per_team) on public.seasons to authenticated;

-- Actes en esborrany: només l'admin.
create policy match_sheets_admin on public.match_sheets for select to authenticated using (public.is_admin());
create policy player_stats_admin on public.player_stats for select to authenticated using (public.is_admin());

-- Lligues: només els seus mànagers.
create policy leagues_member on public.leagues for select to authenticated using (public.is_league_member(id));
create policy managers_member on public.managers for select to authenticated using (public.is_league_member(league_id));
create policy managers_rename on public.managers for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant update (team_name) on public.managers to authenticated;
create policy ownership_member on public.ownership for select to authenticated using (public.is_league_member(league_id));
create policy snapshots_member on public.lineup_snapshots for select to authenticated using (public.is_league_member(league_id));
create policy scores_member on public.manager_scores for select to authenticated using (public.is_league_member(league_id));
create policy listings_member on public.market_listings for select to authenticated using (public.is_league_member(league_id));

-- Privat de cada mànager.
create policy lineups_own on public.lineups for select to authenticated using (public.is_my_manager(manager_id));
create policy bids_own on public.bids for select to authenticated using (public.is_my_manager(manager_id));
create policy offers_parties on public.offers for select to authenticated using (public.is_my_manager(from_manager) or public.is_my_manager(to_manager));
create policy trades_parties on public.trades for select to authenticated using (public.is_my_manager(from_manager) or public.is_my_manager(to_manager));
create policy transactions_own on public.transactions for select to authenticated using (public.is_my_manager(manager_id));

-- Funcions: les internes (schema private) no són accessibles; les RPC, només per a autenticats.
revoke all on all functions in schema private from public;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

-- Supabase ------------------------------------------------------------------

do $$
begin
  -- Temps real: classificació, punts, mercat i propostes (RLS inclosa).
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.manager_scores, public.player_points, public.fixtures, public.ownership,
      public.offers, public.trades, public.market_listings;
  end if;

  -- Tasques programades.
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('apa-tick', '* * * * *', 'select private.tick()');
  end if;

  -- Fotos: bucket privat (són menors). Llegeixen els autenticats (URL signades), escriu l'admin.
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('player-photos', 'player-photos', false) on conflict do nothing;
    execute $p$create policy player_photos_read on storage.objects for select to authenticated using (bucket_id = 'player-photos')$p$;
    execute $p$create policy player_photos_insert on storage.objects for insert to authenticated with check (bucket_id = 'player-photos' and public.is_admin())$p$;
    execute $p$create policy player_photos_update on storage.objects for update to authenticated using (bucket_id = 'player-photos' and public.is_admin())$p$;
    execute $p$create policy player_photos_delete on storage.objects for delete to authenticated using (bucket_id = 'player-photos' and public.is_admin())$p$;
  end if;
end $$;
