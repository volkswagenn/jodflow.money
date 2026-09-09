-- ไฟล์: supabase/users.sql
-- ============================================================================
-- JodFlow — ระบบล็อกอินของเราเอง · สมัครเอง · ทดลอง 14 วัน · แอดมินระบบ   [users.sql]
--
-- ★ ไฟล์ประจำเรื่อง "บัญชีผู้ใช้ / session / ร้านของลูกค้า / แอดมินระบบ" ★
-- มีอะไรเปลี่ยนเรื่องนี้ จะถูกเพิ่มลงไฟล์นี้เสมอ ไม่แตกไฟล์ใหม่
-- เวลาอัปเดต: เปิดแท็บเดิมใน SQL Editor ลบของเก่าออก วางไฟล์นี้ทั้งไฟล์ แล้ว Run
--
-- ทำตามแบบ Jodflow.order/docs/LOGIN-SYSTEM-REFERENCE.md — ระบบล็อกอินเป็นของเราเอง
-- ไม่ใช้ Supabase Auth อีกต่อไป (Supabase ยังใช้เป็นฐานข้อมูล + Storage เหมือนเดิม)
--
-- ⚠️ ข้อมูลจริงปลอดภัย — ไฟล์นี้ไม่มี drop table / truncate และไม่มี update หรือ delete
--    ที่แตะตารางข้อมูลการเงิน (transactions, wallet_state, ฯลฯ) แม้แต่คำสั่งเดียว
--    สิ่งที่ "แตะ" มีสามอย่าง และทั้งหมดเป็นเรื่องตัวตน/สิทธิ์ ไม่ใช่ตัวข้อมูล:
--      • คัดลอกบัญชีจาก auth.users มาไว้ที่ app_users (id เดิมทุกตัว — ข้อมูลที่ชี้ถึงจึงไม่ขยับ)
--      • ย้ายปลาย foreign key ของคอลัมน์ "ใครทำ" จาก auth.users → app_users
--      • update shops.status + insert/delete แถวใน shop_members เฉพาะร้านของเราเอง (หมวด 13)
--    ทั้งไฟล์รันใน transaction เดียว — ล้มตรงไหน ทุกอย่างถอยกลับหมด ไม่มีสถานะครึ่งๆ กลางๆ
--    ทุกคำสั่งเป็น if not exists / create or replace → รันซ้ำกี่รอบก็ได้ผลเหมือนเดิม
--
-- ต้องรัน setup.sql (หรือ schema+policies+functions) มาก่อนแล้ว ไฟล์นี้ต่อยอดจากของเดิม
--
-- ── สิ่งที่อยู่ในไฟล์นี้ ────────────────────────────────────────────────────
--   0 กันรันผิดโปรเจกต์
--   1 ตารางระบบล็อกอิน: app_users · app_sessions · login_attempts · password_reset_tokens
--   2 ย้ายบัญชีเดิมจาก auth.users → app_users และย้าย foreign key ทุกจุด
--   3 หัวใจ: app_uid() + pre-request hook ที่ทำให้ auth.uid() ตอบเป็นผู้ใช้ของเรา
--   4 สถานะร้าน / วันหมดอายุ / ค่าตั้งแพลตฟอร์ม / audit log / คิวรีเซ็ตรหัส
--   5 กติกาสิทธิ์ is_member · can_edit · is_owner · is_platform_admin (อ่านจาก app_uid)
--   6 policy + trigger กันลูกค้าเลื่อนขั้นตัวเอง / ต่ออายุเอง
--   7 ตอนสร้างร้าน: ทดลอง 14 วัน · 1 บัญชี 1 ร้าน · owner อัตโนมัติ
--   8 ตัวจำกัดจำนวนครั้ง (sliding window) + กติการหัสผ่าน
--   9 RPC ล็อกอิน: app_signup · app_login · app_me · app_logout · app_change_password · sessions
--  10 ลืมรหัสผ่าน: ยืนยันด้วยวันเกิด + เบอร์ → ตั้งรหัสใหม่เอง · ไม่ผ่าน → คิวแอดมิน
--  11 RPC หน้าแอดมิน (ทุกตัวบังคับเขียน audit log) + ออกรหัสชั่วคราว / ปิดบัญชี / เตะออก
--  12 แจ้งทุกเครื่องเมื่อข้อมูลเปลี่ยน (แทน postgres_changes ที่ใช้ไม่ได้กับ auth ของเราเอง)
--  13 บทบาท: admin@admin.co = แอดมินระบบ · folkswagen.th@gmail.com = เจ้าของร้านข้อมูลจริง
--  14 ตรวจผล — ต้องอ่านตารางท้ายไฟล์ก่อนปิดแท็บ (มีรหัสผ่านชั่วคราวถ้าเพิ่งสร้างบัญชี)
-- ============================================================================


-- ###########################################################################
-- ##  0. กันรันผิดโปรเจกต์
-- ###########################################################################
--
-- บัญชี Supabase เดียวมีหลายโปรเจกต์ และ SQL Editor เปิดค้างไว้ทีละหลายแท็บ
-- ไฟล์นี้ต้องรันในโปรเจกต์ของ JodFlow.money เท่านั้น (ref: ftpoidvwoeacbpyubbbm)

do $guard$
begin
  if to_regclass('public.profiles') is null or to_regclass('public.shops') is null then
    raise exception E'⛔ รันผิดโปรเจกต์\n'
      '   ฐานข้อมูลนี้ไม่มีตาราง profiles / shops จึงไม่ใช่ฐานของ JodFlow.money\n'
      '   ให้สลับโปรเจกต์บนแถบซ้ายบนไปที่โปรเจกต์ที่ URL ลงท้ายด้วย ftpoidvwoeacbpyubbbm\n'
      '   ยังไม่มีอะไรถูกแก้ในฐานข้อมูลนี้';
  end if;
end $guard$;

-- pgcrypto ของ Supabase อยู่ใน schema extensions (ไม่ใช่ public) — ทุกฟังก์ชันในไฟล์นี้จึงตั้ง
-- search_path = public, extensions ไม่งั้น digest/crypt/gen_salt หาไม่เจอ (42883)
create extension if not exists "pgcrypto" with schema extensions;
set search_path = public, extensions, pg_temp;


-- ###########################################################################
-- ##  1. ตารางระบบล็อกอิน
-- ###########################################################################
--
-- ทำหน้าที่แทน auth.users แบบตรงตัว — id เป็น uuid เหมือนกัน ตารางอื่นจึงแค่ย้ายปลาย
-- foreign key มาชี้ที่นี่ (หมวด 2) ไม่ต้องแก้โครงสร้างข้อมูลเลย
--
-- ทั้ง 4 ตารางเปิด RLS แล้ว "ไม่มี policy" + revoke จาก anon/authenticated
-- = เบราว์เซอร์แตะตรงไม่ได้ทุกกรณี เข้าถึงได้ทางเดียวคือฟังก์ชัน security definer ข้างล่าง
-- นี่คือด่านที่ทำให้ "ฐานข้อมูลหลุด" ก็ยังสวมรอยใครไม่ได้: ไม่มีรหัสผ่านตัวจริง ไม่มี token ตัวจริง

create table if not exists app_users (
  id                   uuid primary key default gen_random_uuid(),
  email                text not null,                 -- เก็บตัวพิมพ์เล็กเสมอ (บังคับด้วย index ข้างล่าง)
  password_hash        text not null,                 -- bcrypt cost 10 (เท่า Supabase เดิม → แฮชเก่าใช้ต่อได้)
  display_name         text,
  is_active            boolean not null default true, -- ปิดบัญชีโดยไม่ลบ — ลบแล้ว audit log ชี้ไปหาคนที่ไม่มีตัวตน
  must_change_password boolean not null default false,-- แอดมินออกรหัสชั่วคราวให้ → เข้าครั้งเดียวแล้วต้องตั้งใหม่
  is_platform_admin    boolean not null default false,-- ⚠️ ตั้งได้จากไฟล์นี้ (หมวด 13) เท่านั้น ไม่มีทางตั้งจากหน้าจอ
  birth_date           date,                          -- ใช้ยืนยันตัวตอนลืมรหัสผ่าน (หมวด 10)
  phone                text,                          -- เก็บเฉพาะตัวเลข 0xxxxxxxxx — ใช้คู่กับวันเกิด
  signup_channel       text not null default 'SIGNUP' check (signup_channel in ('SIGNUP', 'ADMIN', 'MIGRATED')),
  last_sign_in_at      timestamptz,
  password_changed_at  timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists app_users_email_key on app_users (lower(email));

create table if not exists app_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references app_users(id) on delete cascade,
  token_hash   text not null unique,                  -- sha256 ของ token — ไม่เคยเก็บตัวจริง
  expires_at   timestamptz not null,
  user_agent   text,
  ip           text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at   timestamptz
);
create index if not exists app_sessions_user_idx on app_sessions (user_id, created_at desc);
create index if not exists app_sessions_exp_idx  on app_sessions (expires_at);

-- ครั้งที่กรอกผิด — ไม่มีคอลัมน์ "ล็อกถึงเมื่อไหร่" นับย้อนหลังเอา (หน้าต่างเลื่อน)
-- kind แยกถัง: login / reset / signup เพราะแต่ละอย่างเพดานไม่เท่ากัน (หมวด 8)
create table if not exists login_attempts (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'login' check (kind in ('login', 'reset', 'signup')),
  email      text not null default '',
  ip         text not null default 'unknown',
  created_at timestamptz not null default now()
);
create index if not exists login_attempts_email_idx on login_attempts (kind, email, created_at);
create index if not exists login_attempts_ip_idx    on login_attempts (kind, ip, created_at);

-- ตั๋วตั้งรหัสใหม่ — ใช้แล้วประทับเวลา ไม่ลบ ต้องตอบได้ว่าตั๋วนี้ถูกใช้เมื่อไหร่
create table if not exists password_reset_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  ip         text,
  created_at timestamptz not null default now()
);
create index if not exists password_reset_tokens_user_idx on password_reset_tokens (user_id);

alter table app_users             enable row level security;
alter table app_sessions          enable row level security;
alter table login_attempts        enable row level security;
alter table password_reset_tokens enable row level security;
revoke all on table app_users             from public, anon, authenticated;
revoke all on table app_sessions          from public, anon, authenticated;
revoke all on table login_attempts        from public, anon, authenticated;
revoke all on table password_reset_tokens from public, anon, authenticated;


-- ###########################################################################
-- ##  2. ย้ายบัญชีเดิม + ย้าย foreign key
-- ###########################################################################
--
-- คัดลอกทุกบัญชีจาก auth.users มา app_users ด้วย id เดิม + แฮชรหัสผ่านเดิม
-- (Supabase เก็บ bcrypt $2a$10$… ซึ่ง pgcrypto crypt() อ่านออก → ล็อกอินด้วยรหัสเดิมได้ทันที)
-- แล้วย้ายปลาย FK ของทุกคอลัมน์ "ใครทำ" จาก auth.users → app_users
--
-- auth.users ไม่ถูกลบ ไม่ถูกแก้ — แค่เลิกใช้ ถ้าวันหน้าอยากถอยกลับ ข้อมูลตั้งต้นยังอยู่ครบ

do $mig$
declare
  r        record;
  v_copied int;
  v_orphan int;
begin
  -- ── 2.1 คัดลอกบัญชี ─────────────────────────────────────────────────────
  insert into app_users (id, email, password_hash, display_name, signup_channel, created_at, last_sign_in_at)
  select u.id,
         lower(u.email),
         coalesce(u.encrypted_password, crypt(encode(gen_random_bytes(24), 'hex'), gen_salt('bf', 10))),
         coalesce(u.raw_user_meta_data ->> 'display_name', split_part(u.email, '@', 1)),
         'MIGRATED',
         u.created_at,
         u.last_sign_in_at
    from auth.users u
   where u.email is not null
  on conflict (id) do nothing;
  get diagnostics v_copied = row_count;
  if v_copied > 0 then
    raise notice '✓ คัดลอกบัญชีจาก auth.users มา app_users % บัญชี (id เดิม รหัสผ่านเดิม)', v_copied;
  end if;

  -- ── 2.2 ธงแอดมินที่เคยอยู่บน profiles (users.sql รุ่นก่อน) → ย้ายมา app_users ──
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_platform_admin') then
    update app_users a set is_platform_admin = true
      from profiles p where p.id = a.id and p.is_platform_admin and not a.is_platform_admin;
    drop trigger  if exists profiles_guard_admin on profiles;
    drop function if exists public.guard_platform_admin_flag();
    -- policy profiles_select รุ่นก่อนอ้าง is_platform_admin() ซึ่งอ่านคอลัมน์นี้ — ต้องปลดก่อน drop
    drop policy if exists profiles_select on profiles;
    alter table profiles drop column is_platform_admin;
    raise notice '✓ ย้ายธงแอดมินจาก profiles.is_platform_admin → app_users.is_platform_admin';
  end if;

  -- ── 2.3 ย้าย foreign key ─────────────────────────────────────────────────
  --
  -- คอลัมน์ "ใครทำ" ที่ว่างได้: ค่าที่ไม่มีใน app_users (บัญชีที่ถูกลบไปแล้ว) → ตั้งเป็น NULL
  -- ห้าม delete แถวเด็ดขาด — แถวคือรายการเงิน แค่ไม่รู้ว่าใครบันทึกไม่ใช่เหตุให้ทิ้งทั้งแถว
  for r in
    select * from (values
      ('shops',            'created_by'),
      ('transactions',     'created_by'),
      ('pending_payments', 'created_by'),
      ('pending_incomes',  'created_by'),
      ('tax_invoices',     'created_by'),
      ('calendar_notes',   'updated_by'),
      ('activity_logs',    'user_id'),
      ('card_installments','created_by'),
      ('card_advances',    'created_by'),
      ('card_row_marks',   'marked_by'),
      ('debts',            'created_by'),
      ('payment_slips',    'created_by')
    ) as t(tbl, col)
  loop
    if to_regclass('public.' || r.tbl) is null then continue; end if;   -- ไฟล์นั้นยังไม่เคยรัน
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = r.tbl and column_name = r.col) then
      continue;
    end if;

    execute format('update %I set %I = null where %I is not null and %I not in (select id from app_users)',
                   r.tbl, r.col, r.col, r.col);
    get diagnostics v_orphan = row_count;
    if v_orphan > 0 then
      raise notice '  · %.%: ล้างค่า "ใครทำ" ที่ชี้บัญชีที่ไม่มีแล้ว % แถว (ตัวรายการยังอยู่ครบ)', r.tbl, r.col, v_orphan;
    end if;

    execute format('alter table %I drop constraint if exists %I', r.tbl, r.tbl || '_' || r.col || '_fkey');
    execute format('alter table %I add constraint %I foreign key (%I) references app_users(id)',
                   r.tbl, r.tbl || '_' || r.col || '_fkey', r.col);
  end loop;

  -- profiles / shop_members ผูกแน่น (not null + cascade) — ถ้ามีแถวชี้บัญชีที่ไม่มี ต้องหยุดให้คนดู
  -- ไม่ลบให้เองเพราะ shop_members ที่หายไป = ร้านนั้นไม่มีใครเข้าได้ (อาการที่ check.sql หัวข้อ 3 จับ)
  select count(*) into v_orphan from shop_members m where m.user_id not in (select id from app_users);
  if v_orphan > 0 then
    raise exception E'⛔ shop_members มี % แถวที่ชี้บัญชีซึ่งไม่มีใน auth.users/app_users\n'
      '   ไม่ย้ายให้เองเพราะจะทำให้ร้านไม่มีเจ้าของ — รัน check.sql แล้วส่งผลหัวข้อ 2-3 มาก่อน', v_orphan;
  end if;
  delete from profiles p where p.id not in (select id from app_users);   -- โปรไฟล์ที่ไม่มีบัญชี = ขยะ ไม่ใช่ข้อมูล

  alter table profiles     drop constraint if exists profiles_id_fkey;
  alter table profiles     add  constraint profiles_id_fkey
    foreign key (id) references app_users(id) on delete cascade;
  alter table shop_members drop constraint if exists shop_members_user_id_fkey;
  alter table shop_members add  constraint shop_members_user_id_fkey
    foreign key (user_id) references app_users(id) on delete cascade;

  -- trigger ที่สร้าง profiles ตอน auth.users มีแถวใหม่ — เลิกใช้ (app_signup สร้างเอง)
  drop trigger  if exists on_auth_user_created on auth.users;
  drop function if exists public.handle_new_user();

  -- โปรไฟล์ต้องมีครบทุกบัญชี (หน้าจออ่านชื่อจากตรงนี้)
  insert into profiles (id, email, display_name)
  select a.id, a.email, a.display_name from app_users a
  on conflict (id) do nothing;
end $mig$;


-- ###########################################################################
-- ##  3. หัวใจ: app_uid() + pre-request hook
-- ###########################################################################
--
-- ทำไมไม่เขียน policy ใหม่ทั้งหมด: policy ของ 26 ตาราง และ RPC การเงิน 13 ตัว
-- (post_transaction, pay_debt_entry, close_card_statement, …) ล้วนเรียก auth.uid()
-- การไล่แก้ทุกตัวคือความเสี่ยงสูงสุดต่อข้อมูลจริง
--
-- ทางที่เลือก: ให้ auth.uid() "ตอบเป็นผู้ใช้ของเรา" แทน — PostgREST มี pre-request hook
-- (pgrst.db_pre_request) ที่รันต้นทุก request หลังสลับ role แล้ว เราใช้มันอ่าน header
-- x-session-token → หา app_sessions → ตั้ง request.jwt.claims.sub เป็น user_id
-- ตั้งแต่บรรทัดนั้น auth.uid() ทั้ง request ก็คือคนของเรา โดยไม่ต้องแตะ policy/RPC เดิมเลย
--
-- นี่คือ "2 ชั้น" ตามแบบ ref: ชั้น 1 = มี header ไหม (ถูกมาก) · ชั้น 2 = ตั๋วยังมีชีวิตในฐานไหม
-- (ถอนตั๋ว/ปิดบัญชีมีผลกับ request ถัดไปทันที ไม่ต้องรอ token หมดอายุ)

create or replace function public.app_hash_token(p_token text)
returns text language sql immutable set search_path = public, extensions, pg_temp as $fn$
  select encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
$fn$;
revoke all on function public.app_hash_token(text) from public, anon, authenticated;

-- อ่าน header จาก request — PostgREST ยัดทุก header (ชื่อพิมพ์เล็ก) ไว้ใน request.headers
create or replace function public.app_request_header(p_name text)
returns text language sql stable set search_path = public, extensions, pg_temp as $fn$
  select nullif(btrim(coalesce(
    (nullif(current_setting('request.headers', true), '')::json ->> lower(p_name)), '')), '');
$fn$;
revoke all on function public.app_request_header(text) from public, anon, authenticated;

-- ไอพีของผู้เรียก — อ่านไม่ได้ให้เป็น 'unknown' แล้วกติกาต่อไอพีจะข้ามค่านี้ไป (หมวด 8)
create or replace function public.app_client_ip()
returns text language sql stable set search_path = public, extensions, pg_temp as $fn$
  select coalesce(nullif(btrim(split_part(coalesce(app_request_header('x-forwarded-for'), ''), ',', 1)), ''), 'unknown');
$fn$;
revoke all on function public.app_client_ip() from public, anon, authenticated;

-- ตั๋วในฐานที่ตรงกับ header ตอนนี้ (ยังไม่หมดอายุ ไม่ถูกถอน บัญชียังเปิด) — NULL = ไม่มี
create or replace function public.app_session_from_header()
returns app_sessions language sql stable security definer set search_path = public, extensions, pg_temp as $fn$
  select s.*
    from app_sessions s
    join app_users u on u.id = s.user_id
   where app_request_header('x-session-token') is not null
     and s.token_hash = app_hash_token(app_request_header('x-session-token'))
     and s.revoked_at is null
     and s.expires_at > now()
     and u.is_active
   limit 1;
$fn$;
revoke all on function public.app_session_from_header() from public, anon, authenticated;

-- ใครคือผู้เรียก — ตัวเดียวที่ทุกกติกาสิทธิ์ในไฟล์นี้ใช้
--   • ผ่าน PostgREST ปกติ: hook ตั้ง claims ไว้แล้ว → auth.uid() ตอบทันที ไม่ต้อง query
--   • ผ่านทางที่ไม่มี hook (เช่น Storage API): ตกมาอ่าน header เอง
--   • SQL Editor: ไม่มีทั้งสองอย่าง → NULL = ไม่ได้ล็อกอิน ซึ่งเป็นค่าตั้งต้นที่ปลอดภัย
create or replace function public.app_uid()
returns uuid language sql stable security definer set search_path = public, extensions, pg_temp as $fn$
  select coalesce(auth.uid(), (select user_id from app_session_from_header()));
$fn$;
revoke all     on function public.app_uid() from public;
grant  execute on function public.app_uid() to anon, authenticated;

-- ── pre-request hook ───────────────────────────────────────────────────────
--
-- ⚠️ ห้ามให้ฟังก์ชันนี้ raise เด็ดขาด — มันรันก่อน "ทุก" request ถ้าพังคือทั้งแอปล่ม
--    ทุกทางที่ไม่เจอตั๋วให้เงียบๆ แล้ว return (= request นั้นเป็น anon ตามปกติ)
--
-- last_seen_at อัปเดตเฉพาะเมื่อเก่ากว่า 5 นาที ไม่งั้นทุก request กลายเป็น write
create or replace function public.app_pre_request()
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
declare
  v_s app_sessions;
begin
  if app_request_header('x-session-token') is null then return; end if;

  v_s := app_session_from_header();
  if v_s.id is null then return; end if;

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_s.user_id, 'role', 'authenticated', 'app_session', v_s.id, 'iss', 'jodflow')::text,
    true);
  perform set_config('request.jwt.claim.sub', v_s.user_id::text, true);

  if v_s.last_seen_at < now() - interval '5 minutes' then
    update app_sessions set last_seen_at = now() where id = v_s.id;
  end if;
exception when others then
  return;   -- อะไรผิดพลาดก็ถือว่าไม่ได้ล็อกอิน ห้ามล้มทั้ง request
end;
$fn$;
revoke all     on function public.app_pre_request() from public;
grant  execute on function public.app_pre_request() to anon, authenticated, service_role;

-- ผูก hook เข้ากับ PostgREST — role postgres ใน Supabase ทำได้ (มี CREATEROLE)
-- ถ้าทำไม่ได้จะขึ้น NOTICE พร้อมคำสั่งให้ไปรันเอง แล้วไฟล์ที่เหลือยังติดตั้งต่อได้
do $hook$
begin
  execute $q$alter role authenticator set pgrst.db_pre_request = 'public.app_pre_request'$q$;
  raise notice '✓ ผูก pre-request hook แล้ว (pgrst.db_pre_request = public.app_pre_request)';
exception when others then
  raise notice '⛔ ผูก pre-request hook ไม่สำเร็จ: %', sqlerrm;
  raise notice '   รันบรรทัดนี้แยกต่างหากในฐานะ postgres:';
  raise notice '   alter role authenticator set pgrst.db_pre_request = ''public.app_pre_request''; notify pgrst, ''reload config'';';
end $hook$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';


-- ###########################################################################
-- ##  4. สถานะร้าน / ค่าตั้งแพลตฟอร์ม / audit log / คิวรีเซ็ตรหัส
-- ###########################################################################
--
-- status  trial     กำลังทดลองใช้ฟรี  (ดูวันหมดที่ expires_at)
--         active    ลูกค้าที่ต่ออายุแล้ว หรือร้านของเราเอง (expires_at = NULL คือไม่มีวันหมด)
--         suspended เราสั่งระงับเอง — ต้องกรอกเหตุผล ผู้ใช้อ่านแล้วรู้ว่าทำไม
--         closed    ปิดบัญชีถาวร (ข้อมูลยังอยู่ ไม่ได้ลบ)
-- ไม่มีสถานะ expired แยก — ร้านหมดอายุ = status ยัง trial/active แต่ expires_at เลยเวลา
-- ตัวตัดสินจริงอยู่ที่ shop_is_open() หมวด 5
--
-- default ของ status เป็น 'active' โดยเจตนา — แถวเดิม (= ร้านข้อมูลจริง) ได้ active + ไม่มีวันหมด
-- ร้านของลูกค้าที่สมัครใหม่ถูก trigger หมวด 7 เขียนทับเป็น trial ตอนสร้าง

alter table shops add column if not exists status         text not null default 'active';
alter table shops add column if not exists expires_at     timestamptz;
alter table shops add column if not exists trial_ends_at  timestamptz;
alter table shops add column if not exists suspend_reason text;
alter table shops add column if not exists closed_at      timestamptz;
alter table shops drop constraint if exists shops_status_check;
alter table shops add  constraint shops_status_check
  check (status in ('trial', 'active', 'suspended', 'closed'));
create index if not exists shops_status_idx on shops (status, expires_at);

-- แถวเดียวตลอดกาล — อยากเปลี่ยนวันทดลอง / ปิดรับสมัคร แก้ที่นี่ ไม่ต้อง deploy
create table if not exists platform_settings (
  id            int primary key default 1 check (id = 1),
  trial_days    int  not null default 14 check (trial_days between 0 and 3650),
  signup_open   boolean not null default true,
  signup_note   text,
  updated_at    timestamptz not null default now()
);
insert into platform_settings (id) values (1) on conflict (id) do nothing;

-- แอดมินแตะร้านไหน เมื่อไหร่ ทำอะไร — เก็บอีเมลเป็นข้อความ ไม่ใช่ FK (บัญชีถูกลบแล้วยังอ่านออก)
-- ไม่มี policy update/delete โดยตั้งใจ = เขียนแล้วแก้ย้อนหลังไม่ได้
create table if not exists admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid,
  admin_email text not null,
  shop_id     uuid,
  action      text not null,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists admin_audit_shop_idx on admin_audit_log (shop_id, created_at desc);
create index if not exists admin_audit_time_idx on admin_audit_log (created_at desc);

-- คิวคำขอรีเซ็ตรหัสผ่านให้แอดมิน — ทางถอยเมื่อยืนยันตัวตนเองไม่ผ่าน (หมวด 10)
create table if not exists password_reset_requests (
  id            uuid primary key default gen_random_uuid(),
  email         text not null check (position('@' in email) > 1 and length(email) <= 200),
  note          text check (length(note) <= 500),
  status        text not null default 'pending' check (status in ('pending', 'done', 'ignored')),
  handled_by    uuid,
  handled_at    timestamptz,
  created_at    timestamptz not null default now()
);
alter table password_reset_requests add column if not exists claimed_phone text;
alter table password_reset_requests add column if not exists reason        text;
create unique index if not exists password_reset_pending_uniq
  on password_reset_requests (lower(email)) where status = 'pending';


-- ###########################################################################
-- ##  5. กติกาสิทธิ์ — แก้ที่เดียว มีผลทุกตาราง
-- ###########################################################################
--
-- policy ของทุกตารางเรียก 3 ฟังก์ชันนี้ การเปลี่ยน "ใครคือผู้เรียก" (auth.uid → app_uid)
-- และเพิ่ม "หมดอายุ" + "แอดมินระบบ" จึงแก้แค่ตรงนี้ ไม่ต้องไล่ policy ทีละตาราง

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public, extensions, pg_temp as $fn$
  select coalesce((select u.is_platform_admin from app_users u where u.id = app_uid() and u.is_active), false);
$fn$;

create or replace function public.is_shop_member(p_shop uuid)
returns boolean language sql stable security definer set search_path = public, extensions, pg_temp as $fn$
  select exists (select 1 from shop_members m where m.shop_id = p_shop and m.user_id = app_uid());
$fn$;

create or replace function public.shop_is_open(p_shop uuid)
returns boolean language sql stable security definer set search_path = public, extensions, pg_temp as $fn$
  select exists (
    select 1 from shops s
    where s.id = p_shop and s.status in ('trial', 'active')
      and (s.expires_at is null or s.expires_at > now())
  );
$fn$;

-- สองตัวนี้ถูกเรียก "ทุกแถว" ของทุก query — เขียนเป็น query เดียว และเช็คสมาชิกก่อนแอดมิน
create or replace function public.is_member(p_shop uuid)
returns boolean language sql stable security definer set search_path = public, extensions, pg_temp as $fn$
  select exists (
    select 1 from shop_members m join shops s on s.id = m.shop_id
     where m.shop_id = p_shop and m.user_id = app_uid()
       and s.status in ('trial', 'active') and (s.expires_at is null or s.expires_at > now())
  ) or public.is_platform_admin();
$fn$;

create or replace function public.can_edit(p_shop uuid)
returns boolean language sql stable security definer set search_path = public, extensions, pg_temp as $fn$
  select exists (
    select 1 from shop_members m join shops s on s.id = m.shop_id
     where m.shop_id = p_shop and m.user_id = app_uid() and m.role in ('owner', 'editor')
       and s.status in ('trial', 'active') and (s.expires_at is null or s.expires_at > now())
  ) or public.is_platform_admin();
$fn$;

create or replace function public.is_owner(p_shop uuid)
returns boolean language sql stable security definer set search_path = public, extensions, pg_temp as $fn$
  select exists (
    select 1 from shop_members m where m.shop_id = p_shop and m.user_id = app_uid() and m.role = 'owner'
  ) or public.is_platform_admin();
$fn$;

grant execute on function public.is_platform_admin(), public.is_shop_member(uuid), public.shop_is_open(uuid),
  public.is_member(uuid), public.can_edit(uuid), public.is_owner(uuid) to anon, authenticated;


-- ###########################################################################
-- ##  6. policy ของตาราง identity + ตารางใหม่ + trigger กันโกง
-- ###########################################################################

-- shops / shop_members อ่านได้แม้ร้านหมดอายุ — ไม่งั้นแอปบอกไม่ได้ว่าทำไมเข้าไม่ได้
drop policy if exists shops_select on shops;
create policy shops_select on shops for select
  using (public.is_shop_member(id) or public.is_platform_admin());
drop policy if exists shops_insert on shops;
create policy shops_insert on shops for insert with check (public.app_uid() is not null);

drop policy if exists shop_members_select on shop_members;
create policy shop_members_select on shop_members for select
  using (public.is_shop_member(shop_id) or public.is_platform_admin());

drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select using (
  id = public.app_uid()
  or public.is_platform_admin()
  or exists (
    select 1 from shop_members me join shop_members other on other.shop_id = me.shop_id
     where me.user_id = public.app_uid() and other.user_id = profiles.id
  )
);
drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update
  using (id = public.app_uid()) with check (id = public.app_uid());

-- ── กันลูกค้าต่ออายุให้ตัวเอง ───────────────────────────────────────────────
-- policy shops_update ปล่อยให้ owner แก้แถวร้านตัวเอง (ใช้เปลี่ยนชื่อ) แต่แถวเดียวกัน
-- มี expires_at — PostgreSQL ไม่มี policy ระดับคอลัมน์ จึงกันด้วย trigger:
-- ใครก็ตามที่ล็อกอินอยู่ ห้ามขยับ 5 คอลัมน์นี้ ทางเดียวคือ RPC แอดมิน (ตั้งธง app.admin_write)
create or replace function public.guard_shop_access_columns()
returns trigger language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
begin
  if public.app_uid() is null then return new; end if;                  -- SQL Editor
  if coalesce(current_setting('app.admin_write', true), '') = 'on' then return new; end if;
  new.status := old.status;  new.expires_at := old.expires_at;  new.trial_ends_at := old.trial_ends_at;
  new.suspend_reason := old.suspend_reason;  new.closed_at := old.closed_at;
  return new;
end;
$fn$;
drop trigger if exists shops_guard_access on shops;
create trigger shops_guard_access before update on shops
  for each row execute function public.guard_shop_access_columns();

-- ── ตารางใหม่ ──────────────────────────────────────────────────────────────
-- role ของ request เป็น anon เสมอ (เราไม่ได้ใช้ JWT ของ Supabase) → grant ให้ anon ด้วย
-- ความปลอดภัยอยู่ที่ policy ซึ่งตัดสินด้วย app_uid()/is_platform_admin() ไม่ใช่ role
alter table platform_settings enable row level security;
drop policy if exists platform_settings_select on platform_settings;
create policy platform_settings_select on platform_settings for select using (true);
drop policy if exists platform_settings_update on platform_settings;
create policy platform_settings_update on platform_settings for update
  using (public.is_platform_admin()) with check (public.is_platform_admin());

alter table admin_audit_log enable row level security;
drop policy if exists admin_audit_select on admin_audit_log;
create policy admin_audit_select on admin_audit_log for select using (public.is_platform_admin());
drop policy if exists admin_audit_insert on admin_audit_log;
create policy admin_audit_insert on admin_audit_log for insert with check (public.is_platform_admin());

alter table password_reset_requests enable row level security;
drop policy if exists password_reset_insert on password_reset_requests;
drop policy if exists password_reset_select on password_reset_requests;
create policy password_reset_select on password_reset_requests for select using (public.is_platform_admin());
drop policy if exists password_reset_update on password_reset_requests;
create policy password_reset_update on password_reset_requests for update
  using (public.is_platform_admin()) with check (public.is_platform_admin());
-- insert ไม่มี policy อีกต่อไป — คำขอถูกสร้างโดย RPC หมวด 10 เท่านั้น (กันสแปมและกันอ่านรายชื่ออีเมล)

grant select         on platform_settings        to anon, authenticated;
grant update         on platform_settings        to anon, authenticated;
grant select, insert on admin_audit_log          to anon, authenticated;
grant select, update on password_reset_requests  to anon, authenticated;
revoke insert        on password_reset_requests  from anon, authenticated;


-- ###########################################################################
-- ##  7. ตอนสร้างร้านใหม่
-- ###########################################################################
--
-- "คนที่กำลังสร้างร้าน" = app.signup_uid (ตั้งโดย app_signup ระหว่างสมัคร ซึ่งตอนนั้น
-- ยังไม่มีตั๋ว) หรือ app_uid() (ล็อกอินอยู่แล้ว) — ไม่มีทั้งคู่ = สร้างจาก SQL Editor
create or replace function public.shop_actor()
returns uuid language sql stable set search_path = public, extensions, pg_temp as $fn$
  select coalesce(nullif(current_setting('app.signup_uid', true), '')::uuid, public.app_uid());
$fn$;

-- BEFORE INSERT: ตั้งวันทดลอง · 1 บัญชี 1 ร้าน · เคารพสวิตช์ปิดรับสมัคร
create or replace function public.prepare_new_shop()
returns trigger language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
declare
  v_actor uuid := public.shop_actor();
  v_days  int;
  v_open  boolean;
begin
  if v_actor is null then return new; end if;                                        -- SQL Editor
  if exists (select 1 from app_users u where u.id = v_actor and u.is_platform_admin) then
    return new;                                                                      -- แอดมินสร้างให้ ไม่ใช่ลูกค้า
  end if;

  select trial_days, signup_open into v_days, v_open from platform_settings where id = 1;
  if coalesce(v_open, true) = false then
    raise exception 'ขณะนี้ปิดรับสมัครสมาชิกใหม่ชั่วคราว' using errcode = '42501';
  end if;
  if exists (select 1 from shop_members m where m.user_id = v_actor) then
    raise exception 'บัญชีนี้มีร้านอยู่แล้ว' using errcode = '42501';
  end if;

  new.status        := 'trial';
  new.trial_ends_at := now() + make_interval(days => coalesce(v_days, 14));
  new.expires_at    := new.trial_ends_at;
  new.suspend_reason := null;
  new.closed_at      := null;
  new.created_by     := coalesce(new.created_by, v_actor);
  return new;
end;
$fn$;
drop trigger if exists on_shop_creating on shops;
create trigger on_shop_creating before insert on shops
  for each row execute function public.prepare_new_shop();

-- AFTER INSERT (ของเดิมใน setup.sql — เขียนใหม่ให้รู้จัก shop_actor): owner + ค่าตั้งต้น
create or replace function public.handle_new_shop()
returns trigger language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
declare v_actor uuid := public.shop_actor();
begin
  if v_actor is not null then
    insert into shop_members (shop_id, user_id, role) values (new.id, v_actor, 'owner')
      on conflict do nothing;
  end if;
  insert into shop_settings (shop_id) values (new.id) on conflict do nothing;
  insert into wallet_state  (shop_id) values (new.id) on conflict do nothing;
  insert into categories (shop_id, name, type)
  select new.id, 'อื่นๆ', t from (values ('expense'), ('income')) as v(t)
   where not exists (select 1 from categories c where c.shop_id = new.id);
  return new;
end;
$fn$;
drop trigger if exists on_shop_created on shops;
create trigger on_shop_created after insert on shops
  for each row execute function public.handle_new_shop();


-- ###########################################################################
-- ##  8. ตัวจำกัดจำนวนครั้ง + กติการหัสผ่าน
-- ###########################################################################
--
-- หน้าต่างเลื่อน (sliding window) เหมือน ref: นับเฉพาะครั้งที่ผิดใน N นาทีที่แล้ว
-- ต่ออีเมล 5 ครั้ง / ต่อไอพี 20 ครั้ง / 15 นาที — ลืมรหัสผ่านเข้มกว่า (ชั่วโมงละ 5)
-- เพราะสิ่งที่คนเดาตรงนั้นคือ "วันเกิด" ซึ่งมีแค่ราวสามหมื่นแบบ ไม่ใช่รหัสผ่าน
-- นับทุกอีเมลที่ถูกกรอก ไม่ว่ามีบัญชีจริงไหม ⇒ บอกเวลารอได้โดยไม่รั่วว่าอีเมลไหนมีอยู่

-- คืน 0 = ลองได้ · >0 = ต้องรออีกกี่วินาที
create or replace function public.app_throttle_check(p_kind text, p_email text, p_ip text)
returns int language plpgsql stable security definer set search_path = public, extensions, pg_temp as $fn$
declare
  v_email_max int;  v_ip_max int;  v_window interval;
  v_cnt int;  v_oldest timestamptz;  v_until timestamptz := null;
begin
  case p_kind
    when 'reset'  then v_email_max := 5;  v_ip_max := 20; v_window := interval '60 minutes';
    when 'signup' then v_email_max := 99; v_ip_max := 5;  v_window := interval '60 minutes';
    else               v_email_max := 5;  v_ip_max := 20; v_window := interval '15 minutes';
  end case;

  select count(*), min(created_at) into v_cnt, v_oldest from login_attempts
   where kind = p_kind and email = lower(coalesce(p_email, '')) and created_at > now() - v_window;
  if v_cnt >= v_email_max then v_until := v_oldest + v_window; end if;

  if coalesce(p_ip, 'unknown') <> 'unknown' then
    select count(*), min(created_at) into v_cnt, v_oldest from login_attempts
     where kind = p_kind and ip = p_ip and created_at > now() - v_window;
    if v_cnt >= v_ip_max then v_until := greatest(coalesce(v_until, v_oldest + v_window), v_oldest + v_window); end if;
  end if;

  if v_until is null then return 0; end if;
  return greatest(1, ceil(extract(epoch from (v_until - now())))::int);
end;
$fn$;

create or replace function public.app_record_failure(p_kind text, p_email text, p_ip text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
begin
  insert into login_attempts (kind, email, ip) values (p_kind, lower(coalesce(p_email, '')), coalesce(p_ip, 'unknown'));
  -- กวาดของเก่าเป็นระยะ (สุ่ม 1 ใน 50 ครั้ง) ตารางจะได้ไม่โตไปเรื่อยๆ
  if random() < 0.02 then delete from login_attempts where created_at < now() - interval '1 day'; end if;
end;
$fn$;

create or replace function public.app_clear_failures(p_kind text, p_email text)
returns void language sql security definer set search_path = public, extensions, pg_temp as $fn$
  delete from login_attempts where kind = p_kind and email = lower(coalesce(p_email, ''));
$fn$;

create or replace function public.app_wait_text(p_sec int)
returns text language sql immutable as $fn$
  select case when p_sec >= 60 then ceil(p_sec / 60.0)::int || ' นาที' else greatest(1, p_sec) || ' วินาที' end;
$fn$;

-- กติการหัสผ่าน (เหมือน src/lib/passwordRules.js ฝั่งหน้าจอ — ที่นี่คือด่านจริง)
-- คืน NULL = ผ่าน ไม่งั้นคืนข้อความบอกเหตุผล
create or replace function public.app_password_problem(p text)
returns text language sql immutable as $fn$
  select case
    when length(btrim(coalesce(p, ''))) < 10 then 'รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร'
    when lower(p) = any (array['password','password1','password123','12345678','123456789','1234567890',
                               'qwertyuiop','iloveyou','admin1234','administrator','letmein123','welcome123'])
      then 'รหัสผ่านนี้ถูกใช้กันทั่วไปเกินไป เดาได้ง่าย — เปลี่ยนเป็นอย่างอื่น'
    else null end;
$fn$;

-- เบอร์โทร → ตัวเลขล้วนรูปในประเทศ (+66812345678 → 0812345678) เหมือน normalizePhone ของ ref
create or replace function public.app_norm_phone(p text)
returns text language sql immutable as $fn$
  select case
    when p is null then ''
    when regexp_replace(p, '\D', '', 'g') ~ '^66' and length(regexp_replace(p, '\D', '', 'g')) >= 11
      then '0' || substr(regexp_replace(p, '\D', '', 'g'), 3)
    else regexp_replace(p, '\D', '', 'g') end;
$fn$;

-- วันเกิด "YYYY-MM-DD" → date · รับ พ.ศ. ด้วย (บางเครื่องส่ง 2540-01-31 มาจริง) · ใช้ไม่ได้ → NULL
create or replace function public.app_birth_date(p text)
returns date language plpgsql immutable as $fn$
declare y int; m int; d int;
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  y := split_part(p, '-', 1)::int;  m := split_part(p, '-', 2)::int;  d := split_part(p, '-', 3)::int;
  if y >= 2400 then y := y - 543; end if;
  if y < 1900 or y > 2200 then return null; end if;
  return make_date(y, m, d);
exception when others then return null;
end;
$fn$;

revoke all on function public.app_throttle_check(text, text, text), public.app_record_failure(text, text, text),
  public.app_clear_failures(text, text) from public, anon, authenticated;


-- ###########################################################################
-- ##  9. RPC ล็อกอิน
-- ###########################################################################
--
-- ทุกตัวคืน jsonb { ok, ... } แทนการ raise — PostgREST ครอบ request ด้วย transaction
-- ถ้า raise ตัวนับที่เพิ่งบวกจะถูก rollback = ตัวจำกัดจำนวนครั้งไม่เคยทำงาน

-- ออกตั๋ว + บังคับโควตา 2 เครื่อง (เตะเครื่องเก่าสุด ไม่บล็อกเครื่องใหม่ — คนตรงหน้าคือคนที่ต้องการใช้จริง)
create or replace function public.app_issue_session(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
declare
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_exp   timestamptz := now() + interval '30 days';
begin
  delete from app_sessions where user_id = p_user and (expires_at <= now() or revoked_at is not null);
  insert into app_sessions (user_id, token_hash, expires_at, user_agent, ip)
  values (p_user, app_hash_token(v_token), v_exp, left(app_request_header('user-agent'), 300), app_client_ip());
  delete from app_sessions
   where user_id = p_user
     and id not in (select id from app_sessions where user_id = p_user order by created_at desc, id limit 2);
  return jsonb_build_object('token', v_token, 'expires_at', v_exp);
end;
$fn$;
revoke all on function public.app_issue_session(uuid) from public, anon, authenticated;

-- ── สมัครสมาชิก = บัญชี + โปรไฟล์ + ร้านของตัวเอง + ตั๋ว ในธุรกรรมเดียว ───────
create or replace function public.app_signup(
  p_email        text,
  p_password     text,
  p_display_name text,
  p_shop_name    text,
  p_birth_date   text default null,
  p_phone        text default null
) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
declare
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_ip     text := app_client_ip();
  v_wait   int;
  v_prob   text;
  v_open   boolean;
  v_note   text;
  v_uid    uuid;
  v_birth  date;
  v_sess   jsonb;
begin
  select signup_open, signup_note into v_open, v_note from platform_settings where id = 1;
  if coalesce(v_open, true) = false then
    return jsonb_build_object('ok', false, 'error', coalesce(v_note, 'ขณะนี้ปิดรับสมัครสมาชิกใหม่ชั่วคราว'));
  end if;

  v_wait := app_throttle_check('signup', v_email, v_ip);
  if v_wait > 0 then
    return jsonb_build_object('ok', false, 'error', 'สมัครถี่เกินไปจากเครื่องนี้ รออีก ' || app_wait_text(v_wait));
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then
    return jsonb_build_object('ok', false, 'error', 'อีเมลไม่ถูกต้อง');
  end if;
  v_prob := app_password_problem(p_password);
  if v_prob is not null then return jsonb_build_object('ok', false, 'error', v_prob); end if;
  if coalesce(btrim(p_display_name), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'กรุณากรอกชื่อ');
  end if;
  v_birth := app_birth_date(p_birth_date);
  if p_birth_date is not null and v_birth is null then
    return jsonb_build_object('ok', false, 'error', 'วันเกิดไม่ถูกต้อง');
  end if;
  if coalesce(app_norm_phone(p_phone), '') <> '' and app_norm_phone(p_phone) !~ '^0\d{8,9}$' then
    return jsonb_build_object('ok', false, 'error', 'เบอร์โทรไม่ถูกต้อง (เช่น 0812345678)');
  end if;

  perform app_record_failure('signup', v_email, v_ip);   -- นับทุกครั้งที่พยายาม กันยิงรัว

  begin
    insert into app_users (email, password_hash, display_name, birth_date, phone, signup_channel)
    values (v_email, crypt(p_password, gen_salt('bf', 10)), btrim(p_display_name), v_birth,
            nullif(app_norm_phone(p_phone), ''), 'SIGNUP')
    returning id into v_uid;
  exception when unique_violation then
    -- ตอบกลางๆ ไม่ยืนยันว่ามีบัญชีนี้อยู่ — ไม่งั้นหน้าสมัครกลายเป็นเครื่องมือไล่ตรวจอีเมลลูกค้า
    return jsonb_build_object('ok', false, 'error', 'สมัครไม่สำเร็จ — ถ้าคุณมีบัญชีอยู่แล้วให้เข้าสู่ระบบ หรือกดลืมรหัสผ่าน');
  end;

  insert into profiles (id, email, display_name) values (v_uid, v_email, btrim(p_display_name))
  on conflict (id) do update set email = excluded.email, display_name = excluded.display_name;

  -- บอก trigger หมวด 7 ว่าใครกำลังสร้างร้าน (ยังไม่มีตั๋ว app_uid() จึงยังว่าง)
  perform set_config('app.signup_uid', v_uid::text, true);
  insert into shops (name, created_by)
  values (coalesce(nullif(btrim(p_shop_name), ''), btrim(p_display_name)), v_uid);
  perform set_config('app.signup_uid', '', true);

  perform app_clear_failures('signup', v_email);
  v_sess := app_issue_session(v_uid);
  update app_users set last_sign_in_at = now() where id = v_uid;

  return jsonb_build_object('ok', true, 'token', v_sess ->> 'token', 'user_id', v_uid);
end;
$fn$;

-- ── ล็อกอิน ────────────────────────────────────────────────────────────────
create or replace function public.app_login(p_email text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_ip    text := app_client_ip();
  v_wait  int;
  v_user  app_users;
  v_sess  jsonb;
  v_wrong jsonb := jsonb_build_object('ok', false, 'error', 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
begin
  v_wait := app_throttle_check('login', v_email, v_ip);
  if v_wait > 0 then
    return jsonb_build_object('ok', false, 'retry_after_sec', v_wait,
      'error', 'ใส่รหัสผิดหลายครั้งเกินไป รออีก ' || app_wait_text(v_wait) || ' แล้วลองใหม่');
  end if;

  select * into v_user from app_users where lower(email) = v_email;

  -- ไม่เจอบัญชี / บัญชีปิด → ยังคำนวณแฮชเท่าเดิม ให้เวลาตอบใกล้กัน กันจับเวลาเดาว่าอีเมลไหนมีจริง
  if v_user.id is null or not v_user.is_active
     or v_user.password_hash <> crypt(coalesce(p_password, ''), v_user.password_hash) then
    if v_user.id is null then perform crypt(coalesce(p_password, ''), gen_salt('bf', 10)); end if;
    perform app_record_failure('login', v_email, v_ip);
    return v_wrong;   -- ข้อความเดียวกันทุกกรณี ห้ามบอกว่า "ไม่มีอีเมลนี้" หรือ "บัญชีถูกปิด"
  end if;

  perform app_clear_failures('login', v_email);
  v_sess := app_issue_session(v_user.id);
  update app_users set last_sign_in_at = now() where id = v_user.id;

  return jsonb_build_object(
    'ok', true, 'token', v_sess ->> 'token', 'user_id', v_user.id,
    'must_change_password', v_user.must_change_password
  );
end;
$fn$;

-- ── ฉันคือใคร (ชั้น 2 ตามแบบ ref — ตั๋วต้องยังมีชีวิตในฐาน) ────────────────
create or replace function public.app_me()
returns jsonb language sql stable security definer set search_path = public, extensions, pg_temp as $fn$
  select jsonb_build_object(
    'id', u.id, 'email', u.email,
    'display_name', coalesce(p.display_name, u.display_name),
    'is_platform_admin', u.is_platform_admin,
    'must_change_password', u.must_change_password,
    'has_birth_date', u.birth_date is not null,
    'phone', u.phone,
    'session_expires_at', s.expires_at
  )
  from app_session_from_header() s
  join app_users u on u.id = s.user_id
  left join profiles p on p.id = u.id;
$fn$;

create or replace function public.app_logout()
returns void language sql security definer set search_path = public, extensions, pg_temp as $fn$
  update app_sessions set revoked_at = now()
   where id = (select id from app_session_from_header()) and revoked_at is null;
$fn$;

-- ออกจากทุกเครื่อง (รวมเครื่องนี้)
create or replace function public.app_logout_all()
returns void language sql security definer set search_path = public, extensions, pg_temp as $fn$
  update app_sessions set revoked_at = now()
   where user_id = (select user_id from app_session_from_header()) and revoked_at is null;
$fn$;

-- เครื่องที่ล็อกอินค้างอยู่ของฉัน — ให้หน้าตั้งค่าแสดงและเตะออกได้ทีละเครื่อง
create or replace function public.app_my_sessions()
returns table (id uuid, user_agent text, ip text, created_at timestamptz, last_seen_at timestamptz, is_current boolean)
language sql stable security definer set search_path = public, extensions, pg_temp as $fn$
  select s.id, s.user_agent, s.ip, s.created_at, s.last_seen_at, s.id = cur.id
    from app_sessions s, app_session_from_header() cur
   where s.user_id = cur.user_id and s.revoked_at is null and s.expires_at > now()
   order by s.created_at desc;
$fn$;

create or replace function public.app_revoke_session(p_id uuid)
returns void language sql security definer set search_path = public, extensions, pg_temp as $fn$
  update app_sessions set revoked_at = now()
   where id = p_id and user_id = (select user_id from app_session_from_header()) and revoked_at is null;
$fn$;

-- เปลี่ยนรหัสผ่าน — ต้องยืนยันรหัสเดิม (ใครยืมเครื่องที่เปิดค้างไว้ต้องยึดบัญชีไม่ได้)
-- เปลี่ยนเสร็จถอนตั๋วเครื่องอื่นทั้งหมด เหลือแค่เครื่องที่กำลังใช้
create or replace function public.app_change_password(p_old text, p_new text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
declare
  v_s    app_sessions := app_session_from_header();
  v_hash text;
  v_prob text;
begin
  if v_s.id is null then return jsonb_build_object('ok', false, 'error', 'เซสชันหมดอายุ กรุณาล็อกอินใหม่'); end if;
  v_prob := app_password_problem(p_new);
  if v_prob is not null then return jsonb_build_object('ok', false, 'error', v_prob); end if;

  select password_hash into v_hash from app_users where id = v_s.user_id;
  if v_hash <> crypt(coalesce(p_old, ''), v_hash) then
    return jsonb_build_object('ok', false, 'error', 'รหัสผ่านเดิมไม่ถูกต้อง');
  end if;

  update app_users
     set password_hash = crypt(p_new, gen_salt('bf', 10)), password_changed_at = now(),
         must_change_password = false, updated_at = now()
   where id = v_s.user_id;
  update app_sessions set revoked_at = now()
   where user_id = v_s.user_id and revoked_at is null and id <> v_s.id;
  return jsonb_build_object('ok', true);
end;
$fn$;

-- แก้ข้อมูลตัวเอง (ชื่อ · วันเกิด · เบอร์) — วันเกิด/เบอร์ตั้งได้จากในระบบเพื่อให้กู้รหัสเองได้
create or replace function public.app_update_me(p_display_name text, p_birth_date text default null, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
declare v_uid uuid := (select user_id from app_session_from_header()); v_birth date;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'เซสชันหมดอายุ กรุณาล็อกอินใหม่'); end if;
  v_birth := app_birth_date(p_birth_date);
  if p_birth_date is not null and p_birth_date <> '' and v_birth is null then
    return jsonb_build_object('ok', false, 'error', 'วันเกิดไม่ถูกต้อง');
  end if;
  update app_users set
    display_name = coalesce(nullif(btrim(p_display_name), ''), display_name),
    birth_date   = coalesce(v_birth, birth_date),
    phone        = coalesce(nullif(app_norm_phone(p_phone), ''), phone),
    updated_at   = now()
  where id = v_uid;
  update profiles set display_name = coalesce(nullif(btrim(p_display_name), ''), display_name) where id = v_uid;
  return jsonb_build_object('ok', true);
end;
$fn$;

revoke all on function public.app_signup(text, text, text, text, text, text), public.app_login(text, text),
  public.app_me(), public.app_logout(), public.app_logout_all(), public.app_my_sessions(),
  public.app_revoke_session(uuid), public.app_change_password(text, text), public.app_update_me(text, text, text)
  from public;
grant execute on function public.app_signup(text, text, text, text, text, text), public.app_login(text, text),
  public.app_me(), public.app_logout(), public.app_logout_all(), public.app_my_sessions(),
  public.app_revoke_session(uuid), public.app_change_password(text, text), public.app_update_me(text, text, text)
  to anon, authenticated;


-- ###########################################################################
-- ##  10. ลืมรหัสผ่าน
-- ###########################################################################
--
-- ไม่มีตัวส่งอีเมล จึงยืนยันด้วย อีเมล + วันเกิด + เบอร์ที่ลงทะเบียน ตรงครบสาม ⇒ ตั้งรหัสใหม่เอง
-- ไม่ตรง / บัญชีเก่าที่ไม่มีวันเกิด ⇒ ตกไปคิวแอดมินอัตโนมัติ ไม่ใช่ทางตัน
-- ของกันที่ห้ามถอด: จำกัดครั้ง (reset 5/ชม.) · ตั๋ว 15 นาทีใช้ครั้งเดียว · ตั้งแล้วเตะทุกเครื่อง ·
-- บันทึกทุกครั้งให้แอดมินเห็นย้อนหลัง · บัญชีแอดมินระบบใช้ทางนี้ไม่ได้ (ต้องยืนยันด้วยคนเสมอ)

-- ข้อความเดียวทุกกรณีที่ไม่ผ่าน — ห้ามแยกตามสาเหตุ (ดูเหตุผลใน ref §4.8)
create or replace function public.app_reset_same_answer()
returns text language sql immutable as $fn$
  select 'ข้อมูลไม่ตรงกับที่ลงทะเบียนไว้ กรุณาตรวจสอบแล้วลองใหม่อีกครั้ง '
      || 'ถ้าแน่ใจว่ากรอกถูกแล้ว แปลว่าบัญชีนี้ยังไม่ได้บันทึกวันเกิดหรือเบอร์โทรไว้ '
      || 'ระบบได้ส่งคำขอให้ผู้ดูแลระบบแล้ว จะมีการติดต่อกลับเพื่อยืนยันตัวตน';
$fn$;

create or replace function public.app_reset_verify(p_email text, p_birth_date text, p_phone text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_ip    text := app_client_ip();
  v_wait  int;
  v_user  app_users;
  v_ok    boolean := false;
  v_reason text;
  v_token text;
begin
  if v_email = '' then return jsonb_build_object('ok', false, 'error', app_reset_same_answer()); end if;

  v_wait := app_throttle_check('reset', v_email, v_ip);   -- กันจำนวนครั้ง "ก่อน" แตะข้อมูล
  if v_wait > 0 then
    return jsonb_build_object('ok', false, 'error',
      'ลองยืนยันตัวตนผิดหลายครั้งเกินไป กรุณารออีก ' || app_wait_text(v_wait) || ' แล้วลองใหม่');
  end if;

  select * into v_user from app_users where lower(email) = v_email;

  if v_user.id is null or not v_user.is_active or v_user.is_platform_admin then
    v_reason := case when v_user.is_platform_admin then 'PLATFORM_ADMIN' else 'MISMATCH' end;
  elsif v_user.birth_date is null or coalesce(v_user.phone, '') = '' then
    v_reason := 'NO_IDENTITY';
  elsif app_birth_date(p_birth_date) is distinct from v_user.birth_date
     or app_norm_phone(p_phone) = '' or app_norm_phone(p_phone) <> v_user.phone then
    v_reason := 'MISMATCH';
  else
    v_ok := true;
  end if;

  if not v_ok then
    perform app_record_failure('reset', v_email, v_ip);
    -- มีบัญชีจริงแต่ยืนยันเองไม่ผ่าน ⇒ เปิดคำขอให้แอดมิน (ไม่มีบัญชี = ไม่สร้างอะไร กันสแปมแอดมิน)
    if v_user.id is not null then
      insert into password_reset_requests (email, claimed_phone, reason, note)
      values (v_email, left(coalesce(p_phone, ''), 40), v_reason, case v_reason
        when 'PLATFORM_ADMIN' then '⚠️ มีคนพยายามกู้บัญชีแอดมินระบบผ่านหน้าลืมรหัสผ่าน — ทางนี้ถูกปฏิเสธเสมอ ตรวจสอบก่อน'
        when 'NO_IDENTITY'    then 'บัญชีนี้ยังไม่ได้บันทึกวันเกิด/เบอร์ จึงยืนยันตัวตนเองไม่ได้ — ยืนยันด้วยคนตามเดิม'
        else 'ยืนยันตัวตนเองไม่ผ่าน (วันเกิดหรือเบอร์ไม่ตรงกับที่ลงทะเบียน)' end)
      on conflict do nothing;   -- มีคำขอค้างอยู่แล้ว (unique index) ไม่ต้องซ้ำ
    end if;
    return jsonb_build_object('ok', false, 'error', app_reset_same_answer());
  end if;

  perform app_clear_failures('reset', v_email);
  v_token := encode(gen_random_bytes(32), 'hex');
  delete from password_reset_tokens where user_id = v_user.id and used_at is null;   -- ใบเดียวต่อบัญชี
  insert into password_reset_tokens (user_id, token_hash, expires_at, ip)
  values (v_user.id, app_hash_token(v_token), now() + interval '15 minutes', v_ip);
  return jsonb_build_object('ok', true, 'reset_token', v_token);
end;
$fn$;

create or replace function public.app_reset_password(p_reset_token text, p_new text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
declare
  v_t    password_reset_tokens;
  v_prob text;
  v_email text;
begin
  select * into v_t from password_reset_tokens
   where token_hash = app_hash_token(p_reset_token) and used_at is null and expires_at > now();
  if v_t.id is null then
    return jsonb_build_object('ok', false, 'error', 'ตั๋วตั้งรหัสใหม่หมดอายุแล้ว เริ่มขั้นตอนลืมรหัสผ่านใหม่อีกครั้ง');
  end if;
  v_prob := app_password_problem(p_new);
  if v_prob is not null then return jsonb_build_object('ok', false, 'error', v_prob); end if;

  update app_users
     set password_hash = crypt(p_new, gen_salt('bf', 10)), password_changed_at = now(),
         must_change_password = false, updated_at = now()
   where id = v_t.user_id
   returning email into v_email;
  update password_reset_tokens set used_at = now() where id = v_t.id;
  update app_sessions set revoked_at = now() where user_id = v_t.user_id and revoked_at is null;   -- เตะทุกเครื่อง

  -- ให้แอดมินเห็นย้อนหลังว่ามีการตั้งรหัสใหม่เอง (แถวสถานะ done ไม่ต้องทำอะไรต่อ)
  update password_reset_requests set status = 'done', handled_at = now()
   where lower(email) = v_email and status = 'pending';
  insert into password_reset_requests (email, reason, status, handled_at, note)
  values (v_email, 'SELF_RESET', 'done', now(), 'ตั้งรหัสผ่านใหม่เองผ่านการยืนยันวันเกิด + เบอร์ (ทุกเครื่องถูกออกจากระบบ)');
  return jsonb_build_object('ok', true);
end;
$fn$;

revoke all on function public.app_reset_verify(text, text, text), public.app_reset_password(text, text) from public;
grant execute on function public.app_reset_verify(text, text, text), public.app_reset_password(text, text)
  to anon, authenticated;


-- ###########################################################################
-- ##  11. RPC ของหน้าแอดมิน
-- ###########################################################################
--
-- ทุกตัว security definer + ตรวจ is_platform_admin() บรรทัดแรก และตัวที่เปลี่ยนแปลงอะไร
-- เขียน audit log ในคำสั่งเดียวกันเสมอ — "ลืมเขียน log" จึงเป็นไปไม่ได้

create or replace function public.assert_platform_admin()
returns void language plpgsql stable security definer set search_path = public, extensions, pg_temp as $fn$
begin
  if not public.is_platform_admin() then raise exception 'ต้องเป็นแอดมินระบบ' using errcode = '42501'; end if;
end;
$fn$;

create or replace function public.current_admin_email()
returns text language sql stable security definer set search_path = public, extensions, pg_temp as $fn$
  select coalesce((select u.email from app_users u where u.id = public.app_uid()), 'unknown');
$fn$;

create or replace function public.admin_log_action(p_shop uuid, p_action text, p_detail jsonb default null)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
begin
  perform public.assert_platform_admin();
  insert into admin_audit_log (admin_id, admin_email, shop_id, action, detail)
  values (public.app_uid(), public.current_admin_email(), p_shop, p_action, p_detail);
end;
$fn$;

drop function if exists public.admin_list_shops();
create or replace function public.admin_list_shops()
returns table (
  shop_id uuid, shop_name text, status text, expires_at timestamptz, trial_ends_at timestamptz,
  suspend_reason text, created_at timestamptz,
  owner_id uuid, owner_email text, owner_name text, owner_active boolean, owner_must_change boolean,
  owner_last_sign_in timestamptz, member_count bigint, tx_count bigint, last_active timestamptz, is_open boolean
) language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
begin
  perform public.assert_platform_admin();
  return query
  select s.id, s.name, s.status, s.expires_at, s.trial_ends_at, s.suspend_reason, s.created_at,
         o.id, o.email, coalesce(o.pname, o.display_name), o.is_active, o.must_change_password, o.last_sign_in_at,
         (select count(*) from shop_members m where m.shop_id = s.id),
         (select count(*) from transactions t where t.shop_id = s.id),
         (select max(l."timestamp") from activity_logs l where l.shop_id = s.id),
         (s.status in ('trial', 'active') and (s.expires_at is null or s.expires_at > now()))
    from shops s
    left join lateral (
      select u.id, u.email, u.display_name, p.display_name as pname, u.is_active, u.must_change_password, u.last_sign_in_at
        from shop_members m join app_users u on u.id = m.user_id left join profiles p on p.id = u.id
       where m.shop_id = s.id and m.role = 'owner' order by m.created_at limit 1
    ) o on true
   order by s.created_at desc;
end;
$fn$;

create or replace function public.admin_set_shop_access(
  p_shop uuid, p_status text, p_expires timestamptz default null, p_reason text default null, p_keep_expires boolean default false
) returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
declare v_old shops%rowtype;
begin
  perform public.assert_platform_admin();
  if p_status not in ('trial', 'active', 'suspended', 'closed') then raise exception 'สถานะไม่ถูกต้อง: %', p_status; end if;
  if p_status = 'suspended' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'ต้องกรอกเหตุผลที่ระงับ — ผู้ใช้ต้องอ่านแล้วรู้ว่าทำไมเข้าไม่ได้';
  end if;
  select * into v_old from shops where id = p_shop;
  if not found then raise exception 'ไม่พบร้านนี้'; end if;

  perform set_config('app.admin_write', 'on', true);
  update shops
     set status = p_status,
         expires_at = case when p_keep_expires then expires_at else p_expires end,
         suspend_reason = case when p_status = 'suspended' then p_reason else null end,
         closed_at = case when p_status = 'closed' then coalesce(closed_at, now()) else null end
   where id = p_shop;
  perform set_config('app.admin_write', 'off', true);

  insert into admin_audit_log (admin_id, admin_email, shop_id, action, detail)
  values (public.app_uid(), public.current_admin_email(), p_shop, 'SET_ACCESS', jsonb_build_object(
    'from_status', v_old.status, 'to_status', p_status, 'from_expires', v_old.expires_at,
    'to_expires', case when p_keep_expires then v_old.expires_at else p_expires end, 'reason', p_reason));
end;
$fn$;

-- ต่ออายุ: นับต่อจากวันหมดเดิมถ้ายังไม่หมด นับจากวันนี้ถ้าหมดแล้ว (คนต่อช้าไม่เสียวันที่จ่ายไป)
create or replace function public.admin_extend_shop(p_shop uuid, p_days int)
returns timestamptz language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
declare v_base timestamptz; v_new timestamptz;
begin
  perform public.assert_platform_admin();
  if p_days is null or p_days <= 0 or p_days > 3650 then raise exception 'จำนวนวันต้องอยู่ระหว่าง 1 ถึง 3650'; end if;
  select greatest(coalesce(expires_at, now()), now()) into v_base from shops where id = p_shop;
  if v_base is null then raise exception 'ไม่พบร้านนี้'; end if;
  v_new := v_base + make_interval(days => p_days);
  perform set_config('app.admin_write', 'on', true);
  update shops set status = 'active', expires_at = v_new, suspend_reason = null, closed_at = null where id = p_shop;
  perform set_config('app.admin_write', 'off', true);
  insert into admin_audit_log (admin_id, admin_email, shop_id, action, detail)
  values (public.app_uid(), public.current_admin_email(), p_shop, 'EXTEND', jsonb_build_object('days', p_days, 'until', v_new));
  return v_new;
end;
$fn$;

create or replace function public.admin_close_reset_request(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
begin
  perform public.assert_platform_admin();
  if p_status not in ('done', 'ignored') then raise exception 'สถานะไม่ถูกต้อง'; end if;
  update password_reset_requests set status = p_status, handled_by = public.app_uid(), handled_at = now()
   where id = p_id and status = 'pending';
  insert into admin_audit_log (admin_id, admin_email, shop_id, action, detail)
  values (public.app_uid(), public.current_admin_email(), null, 'RESET_REQ', jsonb_build_object('request_id', p_id, 'result', p_status));
end;
$fn$;

-- ตั้งรหัสผ่านให้ผู้ใช้ — แอดมินพิมพ์เองก็ได้ (p_password) หรือปล่อยว่างให้ระบบสุ่มให้
-- ฐานเก็บแค่แฮชเสมอ · ทุกเครื่องเดิมถูกเตะออก · คำขอรีเซ็ตที่ค้างอยู่ถูกปิดให้เอง
--
-- p_must_change (ค่าปริยาย true) = ผู้ใช้เข้าด้วยรหัสนี้แล้วถูกบังคับตั้งรหัสของตัวเองทันที
--   ตั้ง false ได้เมื่อแอดมิน "ตั้งรหัสถาวรให้" ตามที่ลูกค้าขอ — แต่แปลว่าแอดมินรู้รหัสของ
--   ลูกค้าตลอดไป จึงบันทึกลง audit log ว่าเลือกแบบไหน และหน้าจอต้องเตือนก่อนกด
--
-- บัญชีแอดมินระบบตั้งทางนี้ไม่ได้ — บัญชีที่เห็นข้อมูลทุกร้านต้องตั้งรหัสด้วยตัวเองเท่านั้น
-- (เปลี่ยน signature จากรุ่นก่อน ต้อง drop ก่อน ไม่งั้น Postgres มองเป็น overload แล้วเรียกกำกวม)
drop function if exists public.admin_issue_temp_password(uuid);
create or replace function public.admin_issue_temp_password(
  p_user        uuid,
  p_password    text default null,
  p_must_change boolean default true
) returns text language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
declare v_temp text; v_email text; v_admin boolean; v_prob text;
begin
  perform public.assert_platform_admin();
  select email, is_platform_admin into v_email, v_admin from app_users where id = p_user;
  if v_email is null then raise exception 'ไม่พบบัญชีนี้'; end if;
  if v_admin then raise exception 'ตั้งรหัสผ่านให้บัญชีแอดมินระบบทางนี้ไม่ได้ — ตั้งด้วยตัวเองที่หน้าตั้งค่า'; end if;

  if coalesce(btrim(p_password), '') = '' then
    -- 12 ตัว ตัดตัวที่สับสน (0/O, 1/l/I) เพราะต้องอ่านทางโทรศัพท์ให้ลูกค้าพิมพ์ตาม
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789', (get_byte(gen_random_bytes(1), 0) % 52) + 1, 1), '')
      into v_temp from generate_series(1, 12);
  else
    v_temp := btrim(p_password);
    -- รหัสที่แอดมินตั้งให้ต้องผ่านกติกาเดียวกับที่ลูกค้าตั้งเอง ไม่งั้นด่านนี้จะกลายเป็น
    -- ทางลัดให้มีรหัสอ่อน ๆ ในระบบโดยที่หน้าจอฝั่งลูกค้าไม่มีวันยอมรับ
    v_prob := app_password_problem(v_temp);
    if v_prob is not null then raise exception '%', v_prob; end if;
  end if;

  update app_users
     set password_hash = crypt(v_temp, gen_salt('bf', 10)), must_change_password = coalesce(p_must_change, true),
         password_changed_at = now(), updated_at = now()
   where id = p_user;
  update app_sessions set revoked_at = now() where user_id = p_user and revoked_at is null;
  update password_reset_requests set status = 'done', handled_by = public.app_uid(), handled_at = now()
   where lower(email) = lower(v_email) and status = 'pending';

  insert into admin_audit_log (admin_id, admin_email, shop_id, action, detail)
  values (public.app_uid(), public.current_admin_email(), null, 'TEMP_PASSWORD', jsonb_build_object(
    'user_id', p_user, 'email', v_email,
    'chosen_by', case when coalesce(btrim(p_password), '') = '' then 'random' else 'admin' end,
    'must_change', coalesce(p_must_change, true)));
  return v_temp;
end;
$fn$;

-- ปิด/เปิดบัญชี — ปิดแล้วล็อกอินไม่ได้ทันที (ตั๋วเดิมถูกเตะ และ pre-request ไม่รับบัญชีที่ปิด)
create or replace function public.admin_set_user_active(p_user uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
declare v_email text; v_admin boolean;
begin
  perform public.assert_platform_admin();
  select email, is_platform_admin into v_email, v_admin from app_users where id = p_user;
  if v_email is null then raise exception 'ไม่พบบัญชีนี้'; end if;
  if v_admin and not p_active then raise exception 'ปิดบัญชีแอดมินระบบจากหน้าจอไม่ได้'; end if;
  update app_users set is_active = p_active, updated_at = now() where id = p_user;
  if not p_active then update app_sessions set revoked_at = now() where user_id = p_user and revoked_at is null; end if;
  insert into admin_audit_log (admin_id, admin_email, shop_id, action, detail)
  values (public.app_uid(), public.current_admin_email(), null,
          case when p_active then 'USER_ENABLE' else 'USER_DISABLE' end, jsonb_build_object('user_id', p_user, 'email', v_email));
end;
$fn$;

-- เตะออกจากทุกเครื่อง (ใช้ตอนลูกค้าแจ้งว่าเครื่องหาย)
create or replace function public.admin_kick_user(p_user uuid)
returns int language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
declare v_n int;
begin
  perform public.assert_platform_admin();
  update app_sessions set revoked_at = now() where user_id = p_user and revoked_at is null;
  get diagnostics v_n = row_count;
  insert into admin_audit_log (admin_id, admin_email, shop_id, action, detail)
  values (public.app_uid(), public.current_admin_email(), null, 'KICK', jsonb_build_object('user_id', p_user, 'sessions', v_n));
  return v_n;
end;
$fn$;

create or replace function public.admin_overview()
returns table (total_shops bigint, open_shops bigint, trial_shops bigint, expired_shops bigint,
               new_7d bigint, active_7d bigint, pending_resets bigint)
language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
begin
  perform public.assert_platform_admin();
  return query select
    (select count(*) from shops),
    (select count(*) from shops where status in ('trial','active') and (expires_at is null or expires_at > now())),
    (select count(*) from shops where status = 'trial' and (expires_at is null or expires_at > now())),
    (select count(*) from shops where status in ('trial','active') and expires_at is not null and expires_at <= now()),
    (select count(*) from shops where created_at > now() - interval '7 days'),
    (select count(distinct shop_id) from activity_logs where "timestamp" > now() - interval '7 days'),
    (select count(*) from password_reset_requests where status = 'pending');
end;
$fn$;

grant execute on function public.assert_platform_admin(), public.current_admin_email(),
  public.admin_log_action(uuid, text, jsonb), public.admin_list_shops(),
  public.admin_set_shop_access(uuid, text, timestamptz, text, boolean), public.admin_extend_shop(uuid, int),
  public.admin_close_reset_request(uuid, text), public.admin_issue_temp_password(uuid, text, boolean),
  public.admin_set_user_active(uuid, boolean), public.admin_kick_user(uuid), public.admin_overview()
  to anon, authenticated;


-- ###########################################################################
-- ##  12. แจ้งทุกเครื่องเมื่อข้อมูลเปลี่ยน
-- ###########################################################################
--
-- ของเดิมใช้ postgres_changes ซึ่งตรวจสิทธิ์ด้วย JWT ของ Supabase Auth — เราไม่มีแล้ว
-- จึงเปลี่ยนเป็น broadcast จาก trigger: ส่งแค่ "ตาราง X ของร้าน Y เปลี่ยน" (ไม่มีตัวข้อมูล)
-- ไปช่อง shop:<id> เครื่องที่ฟังอยู่จะดึงข้อมูลใหม่เองผ่านทางที่มีสิทธิ์ตามปกติ
-- รู้ shop id ก็ฟังได้ = รู้แค่ว่า "มีความเคลื่อนไหว" ไม่เห็นว่าอะไร ยอมรับได้
--
-- ⚠️ ห้ามให้ trigger นี้ล้มการบันทึกเด็ดขาด — ครอบด้วย exception ทั้งก้อน
--    ระบบแจ้งเตือนพังได้ แต่รายการเงินต้องบันทึกสำเร็จเสมอ

create or replace function public.notify_shop_change()
returns trigger language plpgsql security definer set search_path = public, extensions, pg_temp as $fn$
declare v_shop uuid;
begin
  if tg_op = 'DELETE' then v_shop := old.shop_id; else v_shop := new.shop_id; end if;
  if v_shop is null then return null; end if;
  begin
    perform realtime.send(jsonb_build_object('table', tg_table_name, 'op', tg_op), 'change', 'shop:' || v_shop::text, false);
  exception when others then null;
  end;
  return null;
end;
$fn$;

do $rt$
declare t text;
begin
  foreach t in array array[
    'transactions', 'wallet_state', 'transfer_accounts', 'sub_wallets', 'loans',
    'credit_cards', 'card_statements', 'card_installments', 'card_installment_entries',
    'card_advances', 'card_statement_payments', 'card_row_marks', 'debts', 'debt_entries',
    'pending_payments', 'pending_incomes', 'tax_invoices', 'recurring_items', 'recurring_entries',
    'categories', 'vendors', 'quick_items', 'calendar_notes', 'shop_settings', 'payment_slips'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists %I on %I', t || '_notify', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function public.notify_shop_change()',
                   t || '_notify', t);
  end loop;
end $rt$;


-- ###########################################################################
-- ##  13. บทบาท
-- ###########################################################################
--
-- ══════════════════════════════════════════════════════════════════════════
--  ⚙️  แก้ 2 บรรทัดใน declare ข้างล่างเท่านั้น
--
--    แอดมินระบบ   บัญชีที่ดูแลลูกค้าทุกราย → app_users.is_platform_admin (ตั้งได้จากไฟล์นี้ที่เดียว)
--    เจ้าของร้าน  เจ้าของข้อมูลจริง → ถ้ายังไม่มีบัญชี ไฟล์นี้ "สร้างให้" พร้อมรหัสชั่วคราว
--                 (แสดงในตารางผลตรวจท้ายไฟล์ ครั้งเดียว) และบังคับตั้งรหัสใหม่ตอนเข้าครั้งแรก
--
--  ลำดับที่ทำให้: ยกร้านที่มีรายการมากที่สุดให้เจ้าของร้าน → "หลังจากนั้น" ถอนแอดมินออกจากร้านนั้น
--  → สร้างพื้นที่ว่างให้แอดมิน (แอปต้องมีร้านอย่างน้อยหนึ่งถึงจะเปิด /admin ได้)
--  ร้านต้องไม่มีจังหวะที่ไม่มีใครดูแล และไม่แตะร้านของลูกค้ารายอื่นเลย
-- ══════════════════════════════════════════════════════════════════════════

do $own$
declare
  -- ↓↓↓ แก้ 2 บรรทัดนี้ ↓↓↓
  c_platform_admin_email text := 'admin@admin.co';
  c_shop_owner_email     text := 'folkswagen.th@gmail.com';
  -- ↑↑↑ แก้แค่ 2 บรรทัดนี้ ↑↑↑

  c_nil uuid := '00000000-0000-0000-0000-000000000000';
  v_admin uuid;  v_owner uuid;  v_temp text := null;
  v_data_shop uuid;  v_data_name text;  v_data_tx bigint;
  v_owned_shop uuid; v_owned_tx bigint;  v_new_shop uuid;  v_n int;
begin
  select id into v_admin from app_users where lower(email) = lower(c_platform_admin_email);
  select id into v_owner from app_users where lower(email) = lower(c_shop_owner_email);

  -- ── 13.1 แอดมินระบบ ────────────────────────────────────────────────────
  if v_admin is null then
    raise notice '⛔ ไม่พบบัญชี % — รอบนี้ไม่แตะสิทธิ์แอดมินของใครเลย', c_platform_admin_email;
  else
    update app_users set is_platform_admin = (id = v_admin) where is_platform_admin is distinct from (id = v_admin);
    get diagnostics v_n = row_count;
    raise notice '✓ แอดมินระบบ = %  (ปรับสิทธิ์ % บัญชี)', c_platform_admin_email, v_n;
  end if;

  -- ── 13.2 ร้านที่มีข้อมูลจริง = ร้านที่มีรายการมากที่สุด ───────────────────
  select s.id, s.name, coalesce(tx.n, 0) into v_data_shop, v_data_name, v_data_tx
    from shops s left join lateral (select count(*) as n from transactions t where t.shop_id = s.id) tx on true
   order by coalesce(tx.n, 0) desc, s.created_at limit 1;

  -- ── 13.3 เจ้าของร้าน — ไม่มีบัญชีก็สร้างให้ ────────────────────────────
  if v_owner is null then
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789', (get_byte(gen_random_bytes(1), 0) % 52) + 1, 1), '')
      into v_temp from generate_series(1, 12);
    insert into app_users (email, password_hash, display_name, must_change_password, signup_channel)
    values (lower(c_shop_owner_email), crypt(v_temp, gen_salt('bf', 10)), split_part(c_shop_owner_email, '@', 1), true, 'ADMIN')
    returning id into v_owner;
    insert into profiles (id, email, display_name) values (v_owner, lower(c_shop_owner_email), split_part(c_shop_owner_email, '@', 1))
    on conflict (id) do nothing;
    perform set_config('app.result_temp_password', c_shop_owner_email || ' → ' || v_temp, false);
    raise notice '✓ สร้างบัญชี % พร้อมรหัสชั่วคราว (ดูในตารางผลตรวจ) — ต้องตั้งรหัสใหม่ตอนเข้าครั้งแรก', c_shop_owner_email;
  end if;

  select m.shop_id, coalesce((select count(*) from transactions t where t.shop_id = m.shop_id), 0)
    into v_owned_shop, v_owned_tx
    from shop_members m where m.user_id = v_owner and m.role = 'owner' order by m.created_at limit 1;

  if v_owned_shop is not null and v_owned_shop = v_data_shop then
    raise notice '✓ % เป็นเจ้าของร้าน "%" อยู่แล้ว', c_shop_owner_email, v_data_name;
  elsif v_owned_shop is not null and v_owned_tx = 0 and v_data_tx > 0 then
    raise notice '⛔ % ถือร้านเปล่าอยู่ แต่ร้านข้อมูลจริง "%" (% รายการ) ยังเป็นของคนอื่น — หยุดตรงนี้ บอกผมก่อน', c_shop_owner_email, v_data_name, v_data_tx;
  elsif v_owned_shop is not null then
    raise notice '✓ % เป็นเจ้าของร้านอื่นอยู่แล้ว (% รายการ) — ไม่ย้ายให้', c_shop_owner_email, v_owned_tx;
  elsif v_data_shop is null then
    raise notice '⚠️  ไม่พบร้านในฐานข้อมูลนี้เลย';
  else
    insert into shop_members (shop_id, user_id, role) values (v_data_shop, v_owner, 'owner')
    on conflict (shop_id, user_id) do update set role = 'owner';
    raise notice '✓ ยกร้าน "%" (% รายการ) ให้ % เป็นเจ้าของแล้ว', v_data_name, v_data_tx, c_shop_owner_email;
    if v_admin is not null and v_admin <> v_owner then
      delete from shop_members where shop_id = v_data_shop and user_id = v_admin;   -- delete แถวเดียวในไฟล์ · คืนได้ด้วย access.sql
      get diagnostics v_n = row_count;
      if v_n > 0 then raise notice '✓ ถอน % ออกจากสมาชิกร้าน "%" (ยังเข้าดูได้ทาง /admin)', c_platform_admin_email, v_data_name; end if;
    end if;
  end if;

  -- ── 13.4 แอดมินต้องมีพื้นที่ของตัวเอง ─────────────────────────────────
  if v_admin is not null and not exists (select 1 from shop_members m where m.user_id = v_admin) then
    insert into shops (name, created_by) values ('พื้นที่ของแอดมินระบบ', v_admin) returning id into v_new_shop;
    insert into shop_members (shop_id, user_id, role) values (v_new_shop, v_admin, 'owner') on conflict do nothing;
    raise notice '✓ สร้างพื้นที่ว่างให้บัญชีแอดมิน — ล็อกอินแล้วเห็นเมนู /admin ทันที';
  end if;

  -- ── 13.5 ร้านของเราเอง (เจ้าของร้าน + แอดมิน) ไม่มีวันหมดอายุ ──────────
  update shops s set status = 'active', expires_at = null, suspend_reason = null, closed_at = null
   where exists (select 1 from shop_members m where m.shop_id = s.id and m.role = 'owner'
                    and m.user_id in (coalesce(v_owner, c_nil), coalesce(v_admin, c_nil)))
     and (s.status is distinct from 'active' or s.expires_at is not null);
end $own$;

notify pgrst, 'reload schema';


-- ###########################################################################
-- ##  14. ตรวจผล — อ่านตารางนี้ก่อนปิดแท็บ
-- ###########################################################################
--
-- ต้องได้ทุกบรรทัดของหัวข้อ 1 เป็น "ติดตั้งแล้ว"  ·  หัวข้อ 3 มีแอดมินชื่อเดียว
-- หัวข้อ 4 ร้านข้อมูลจริง = active · ไม่มีวันหมดอายุ · ใช้งานได้ · เจ้าของ folkswagen.th@gmail.com
-- หัวข้อ 5 ถ้ามี = รหัสชั่วคราวของบัญชีที่เพิ่งสร้าง **จดไว้ทันที** จะไม่แสดงอีก

select * from (
  select 1 as "ลำดับ", '1 ของใหม่' as "หัวข้อ", t.what as "รายการ",
         case when t.ok then 'ติดตั้งแล้ว' else '⛔ ยังไม่มี — รันไฟล์นี้ไม่ผ่าน' end as "ผล"
  from (values
    ('ตาราง app_users',                  to_regclass('public.app_users') is not null),
    ('ตาราง app_sessions',               to_regclass('public.app_sessions') is not null),
    ('ตาราง login_attempts',             to_regclass('public.login_attempts') is not null),
    ('ตาราง password_reset_tokens',      to_regclass('public.password_reset_tokens') is not null),
    ('ฟังก์ชัน app_pre_request',         to_regprocedure('public.app_pre_request()') is not null),
    ('ฟังก์ชัน app_login',               to_regprocedure('public.app_login(text,text)') is not null),
    ('ฟังก์ชัน app_signup',              to_regprocedure('public.app_signup(text,text,text,text,text,text)') is not null),
    ('ฟังก์ชัน app_reset_verify',        to_regprocedure('public.app_reset_verify(text,text,text)') is not null),
    ('ฟังก์ชัน admin_issue_temp_password', to_regprocedure('public.admin_issue_temp_password(uuid,text,boolean)') is not null),
    ('FK profiles → app_users',          exists (select 1 from pg_constraint c join pg_class r on r.oid = c.confrelid
                                                  where c.conname = 'profiles_id_fkey' and r.relname = 'app_users')),
    ('FK shop_members → app_users',      exists (select 1 from pg_constraint c join pg_class r on r.oid = c.confrelid
                                                  where c.conname = 'shop_members_user_id_fkey' and r.relname = 'app_users')),
    ('FK transactions.created_by → app_users', exists (select 1 from pg_constraint c join pg_class r on r.oid = c.confrelid
                                                  where c.conname = 'transactions_created_by_fkey' and r.relname = 'app_users')),
    ('pre-request hook ผูกกับ authenticator', exists (select 1 from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
                                                  where r.rolname = 'authenticator'
                                                    and array_to_string(s.setconfig, ',') like '%pgrst.db_pre_request=public.app_pre_request%')),
    ('trigger กันลูกค้าต่ออายุเอง',       exists (select 1 from pg_trigger where tgname = 'shops_guard_access' and not tgisinternal)),
    ('trigger แจ้งทุกเครื่อง (transactions)', exists (select 1 from pg_trigger where tgname = 'transactions_notify' and not tgisinternal))
  ) as t(what, ok)

  union all
  select 2, '2 ค่าตั้งแพลตฟอร์ม', 'ทดลองใช้ฟรี',
         trial_days || ' วัน · รับสมัครใหม่: ' || case when signup_open then 'เปิด' else 'ปิด' end
  from platform_settings where id = 1

  union all
  select 3, '3 แอดมินระบบ', u.email, 'เป็นแอดมินระบบแล้ว' from app_users u where u.is_platform_admin
  union all
  select 3, '3 แอดมินระบบ', '—', '⛔ ยังไม่มีแอดมินเลย — ดู NOTICE ด้านบน'
  where not exists (select 1 from app_users where is_platform_admin)

  union all
  select 4, '4 ร้านและสถานะ',
         s.name || '  (' || (select count(*) from transactions t where t.shop_id = s.id) || ' รายการ)',
         s.status
         || ' · ' || case when s.expires_at is null then 'ไม่มีวันหมดอายุ'
                          else 'ถึง ' || to_char(s.expires_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY') end
         || ' · ' || case when s.status in ('trial','active') and (s.expires_at is null or s.expires_at > now())
                          then 'ใช้งานได้' else '⛔ เข้าใช้ไม่ได้' end
         || ' · เจ้าของ ' || coalesce((select u.email from shop_members m join app_users u on u.id = m.user_id
                                        where m.shop_id = s.id and m.role = 'owner' order by m.created_at limit 1),
                                      '⛔ ไม่มี owner — รัน access.sql')
  from shops s

  union all
  select 5, '5 รหัสผ่านชั่วคราว (จดทันที)', split_part(current_setting('app.result_temp_password', true), ' → ', 1),
         split_part(current_setting('app.result_temp_password', true), ' → ', 2)
  where coalesce(current_setting('app.result_temp_password', true), '') <> ''

  union all
  select 6, '6 บัญชีทั้งหมด', u.email,
         case when u.is_active then 'เปิด' else 'ปิด' end
         || case when u.must_change_password then ' · ต้องตั้งรหัสใหม่ตอนเข้า' else '' end
         || ' · ' || u.signup_channel
         || ' · ' || (select count(*) from app_sessions x where x.user_id = u.id and x.revoked_at is null and x.expires_at > now()) || ' เครื่อง'
  from app_users u
) as "ผลตรวจ"
order by "ลำดับ", "รายการ";
