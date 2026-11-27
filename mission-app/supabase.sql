-- とるぞ！ミッションアプリ用の Supabase 設定
-- Supabase の「SQL Editor」に全部貼り付けて「Run」を押すだけでOK（1回だけ）

-- チーム（名前とベストショット）
create table if not exists public.teams (
  no            int primary key,
  name          text not null default '' check (char_length(name) <= 30),
  best_photo_id uuid,
  updated_at    timestamptz not null default now()
);

-- 写真（ファイル本体は Storage の photos バケットに保存）
create table if not exists public.photos (
  id         uuid primary key default gen_random_uuid(),
  team       int  not null references public.teams(no),
  mission    int  not null check (mission between 1 and 20),
  path       text not null,
  thumb_path text not null,
  created_at timestamptz not null default now()
);
create index if not exists photos_team_idx on public.photos(team);

-- チーム1〜4を登録（チームを増やすときはここに番号を足して再実行）
insert into public.teams(no) values (1), (2), (3), (4) on conflict do nothing;

-- ログインなしで使えるようにする（URLを知っている人は誰でも閲覧・投稿・削除できる）
alter table public.teams  enable row level security;
alter table public.photos enable row level security;
grant select, update on public.teams to anon;
grant select, insert, delete on public.photos to anon;

drop policy if exists "teams_read"   on public.teams;
drop policy if exists "teams_update" on public.teams;
drop policy if exists "photos_read"  on public.photos;
drop policy if exists "photos_add"   on public.photos;
drop policy if exists "photos_del"   on public.photos;
create policy "teams_read"   on public.teams  for select to anon using (true);
create policy "teams_update" on public.teams  for update to anon using (true) with check (true);
create policy "photos_read"  on public.photos for select to anon using (true);
create policy "photos_add"   on public.photos for insert to anon with check (true);
create policy "photos_del"   on public.photos for delete to anon using (true);

-- 他のメンバーの投稿をすぐ反映するためのリアルタイム通知
do $$ begin
  alter publication supabase_realtime add table public.teams;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.photos;
exception when duplicate_object then null; end $$;

-- 写真ファイルの置き場所（公開バケット・1枚5MBまで・JPEGのみ）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "photo_files_read" on storage.objects;
drop policy if exists "photo_files_add"  on storage.objects;
drop policy if exists "photo_files_del"  on storage.objects;
create policy "photo_files_read" on storage.objects for select to anon using (bucket_id = 'photos');
create policy "photo_files_add"  on storage.objects for insert to anon with check (bucket_id = 'photos');
create policy "photo_files_del"  on storage.objects for delete to anon using (bucket_id = 'photos');
