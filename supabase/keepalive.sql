-- ═══════════════════════════════════════════════════════════════════════════
--  keepalive.sql — กันโปรเจกต์ Supabase หลับ (FREE plan)
--
--  ทำไมต้องมี
--    แพ็กเกจฟรีของ Supabase หยุดโปรเจกต์ที่ "ไม่มีการใช้งาน" ติดกันราว 7 วัน
--    พอหยุดแล้วแอปเข้าไม่ได้ทั้งระบบ (หน้า login ขึ้น "ต่ออินเทอร์เน็ตไม่ได้" —
--    เคยเจอมาแล้ว) ต้องเข้าแดชบอร์ดไปกด Resume เอง ข้อมูลไม่หาย แต่ลูกค้าใช้ไม่ได้
--    ระหว่างนั้น ยิ่งช่วงที่ไม่มีใครเปิดแอป (วันหยุดยาว) ยิ่งเสี่ยง
--
--  ทำงานยังไง
--    Vercel Cron เรียก api/keepalive.js (ตั้งเวลาใน vercel.json) ซึ่งเรียก keepalive()
--    วันละครั้ง ฟังก์ชันนี้ "เขียน" ลงฐานจริงหนึ่งแถว — การอ่านหน้าเว็บหรือเรียก API
--    ที่ไม่ถึงตัวฐาน อาจไม่ถูกนับเป็นการใช้งาน การเขียนจึงชัวร์กว่า
--    และแถวเดียวกันนี้บอกได้ว่า ping ล่าสุดเข้ามาเมื่อไร (ดูส่วนตรวจผลท้ายไฟล์)
--
--  ความปลอดภัย
--    ใครก็เรียก keepalive() ได้ (ต้องเรียกได้ด้วย key สาธารณะ แบบเดียวกับหน้าเว็บ)
--    แต่มันทำได้อย่างเดียวคือบวกตัวนับในแถวเดียว ไม่อ่าน/ไม่แตะข้อมูลร้านใดๆ
--    ตารางเองปิดไว้ทั้งหมด อ่าน/เขียนตรงไม่ได้
--
--  รันได้ซ้ำ ไม่แตะข้อมูลอื่น — วางทั้งไฟล์ใน SQL Editor ของโปรเจกต์ JODFLOW แล้ว Run
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. กันรันผิดโปรเจกต์ ────────────────────────────────────────────────────
do $guard$
begin
  if to_regclass('public.shop_settings') is null or to_regclass('public.wallet_state') is null then
    raise exception E'⛔ รันผิดโปรเจกต์\n'
      '   ฐานข้อมูลนี้ไม่มีตาราง shop_settings / wallet_state จึงไม่ใช่ฐานของ JodFlow.money\n'
      '   สลับโปรเจกต์ที่แถบซ้ายบนไปโปรเจกต์ JODFLOW (URL ลงท้ายด้วย ftpoidvwoeacbpyubbbm)\n'
      '   แล้ววางไฟล์นี้ใหม่ — ยังไม่มีอะไรถูกแก้ในฐานข้อมูลนี้';
  end if;
end $guard$;

-- ── 1. แถวเดียวเก็บเวลา ping ล่าสุด ─────────────────────────────────────────
create table if not exists public.keepalive (
  id         int primary key default 1 check (id = 1),
  pinged_at  timestamptz not null default now(),
  ping_count bigint not null default 0,
  source     text
);

alter table public.keepalive enable row level security;
revoke all on public.keepalive from anon, authenticated;

-- ── 2. จุดรับ ping ─────────────────────────────────────────────────────────
-- p_source = ใครเป็นคนเรียก (เช่น 'vercel-cron') ไว้ดูตอนไล่ปัญหา ตัดไว้ 40 ตัวอักษร
create or replace function public.keepalive(p_source text default null)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v keepalive;
begin
  insert into keepalive (id, pinged_at, ping_count, source)
  values (1, now(), 1, left(p_source, 40))
  on conflict (id) do update
     set pinged_at  = now(),
         ping_count = keepalive.ping_count + 1,
         source     = left(excluded.source, 40)
  returning * into v;
  return json_build_object('pinged_at', v.pinged_at, 'ping_count', v.ping_count);
end;
$$;

revoke all on function public.keepalive(text) from public;
grant execute on function public.keepalive(text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ── 3. ตรวจผล ──────────────────────────────────────────────────────────────
-- ping หนึ่งครั้งตอนรันไฟล์นี้ แล้วแสดงแถว — ping_count เพิ่มทุกครั้งที่ cron เรียก
-- ถ้า pinged_at เก่ากว่า 2 วัน แปลว่า cron ไม่ได้ทำงาน ไปดู Vercel → โปรเจกต์ → Settings → Cron Jobs
select public.keepalive('sql-editor') as "ping";
select pinged_at as "ping ล่าสุด",
       ping_count as "ping ทั้งหมด",
       source as "จาก",
       case when pinged_at > now() - interval '2 days' then '✅' else '⚠️ เกิน 2 วันแล้ว' end as "ผล"
  from public.keepalive;
