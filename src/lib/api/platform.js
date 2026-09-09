import { supabase, toThaiError, unwrap } from '../supabase'

/**
 * เรื่องระดับ "แพลตฟอร์ม" — ไม่ผูกกับร้านใดร้านหนึ่ง จึงไม่เรียก getShopId()
 * เหมือนไฟล์ api อื่นๆ (ตัวนั้นจะ throw ถ้ายังไม่ได้เลือกร้าน ซึ่งหน้าสมัคร
 * และหน้าแอดมินยังไม่มีร้านให้เลือก)
 *
 * ทุกฟังก์ชันฝั่งแอดมินยิงผ่าน RPC ที่ตรวจ is_platform_admin() และเขียน audit log
 * ในคำสั่งเดียวกัน (ดู supabase/users.sql หมวด 10) — หน้าจอจึงข้ามการบันทึกไม่ได้
 * แม้จะแก้โค้ดฝั่งเบราว์เซอร์
 */

// ── ใช้ได้โดยยังไม่ล็อกอิน ──────────────────────────────────────────────────

/** ค่าตั้งของแพลตฟอร์ม — หน้าสมัครต้องรู้ว่ายังเปิดรับอยู่ไหม และทดลองกี่วัน */
export async function loadPlatformSettings() {
  const row = await unwrap(
    supabase.from('platform_settings').select('trial_days, signup_open, signup_note').eq('id', 1).maybeSingle()
  )
  return {
    trialDays: Number(row?.trial_days ?? 14),
    signupOpen: row?.signup_open ?? true,
    signupNote: row?.signup_note ?? null,
  }
}

/**
 * ส่งคำขอรีเซ็ตรหัสผ่านเข้าคิวให้แอดมิน (ระบบยังไม่ได้ต่อ SMTP)
 *
 * ตอบว่า "รับเรื่องแล้ว" เหมือนกันทุกกรณี ไม่ว่าอีเมลนั้นจะมีบัญชีอยู่จริงหรือไม่
 * ถ้าตอบต่างกัน หน้านี้จะกลายเป็นเครื่องมือไล่ตรวจว่าอีเมลไหนเป็นลูกค้าเรา
 * ส่วนอีเมลเดิมที่มีคำขอค้างอยู่แล้วจะชน unique index → กลืน error นั้นทิ้ง
 */
export async function requestPasswordReset(email, note) {
  const { error } = await supabase
    .from('password_reset_requests')
    .insert({ email: email.trim().toLowerCase(), note: note?.trim() || null })

  if (error && error.code !== '23505') {
    throw new Error(toThaiError(error))
  }
}

// ── เฉพาะแอดมินระบบ ────────────────────────────────────────────────────────

export async function adminOverview() {
  const rows = await unwrap(supabase.rpc('admin_overview'))
  const r = rows?.[0] ?? {}
  return {
    totalShops: Number(r.total_shops ?? 0),
    openShops: Number(r.open_shops ?? 0),
    trialShops: Number(r.trial_shops ?? 0),
    expiredShops: Number(r.expired_shops ?? 0),
    new7d: Number(r.new_7d ?? 0),
    active7d: Number(r.active_7d ?? 0),
    pendingResets: Number(r.pending_resets ?? 0),
  }
}

export async function adminListShops() {
  const rows = await unwrap(supabase.rpc('admin_list_shops'))
  return (rows ?? []).map((r) => ({
    id: r.shop_id,
    name: r.shop_name,
    status: r.status,
    expiresAt: r.expires_at,
    trialEndsAt: r.trial_ends_at,
    suspendReason: r.suspend_reason,
    createdAt: r.created_at,
    ownerId: r.owner_id ?? null,
    ownerEmail: r.owner_email,
    ownerName: r.owner_name,
    ownerActive: r.owner_active ?? true,
    ownerMustChange: Boolean(r.owner_must_change),
    ownerBirthDate: r.owner_birth_date ?? null,
    ownerPhone: r.owner_phone ?? null,
    ownerLastSignIn: r.owner_last_sign_in ?? null,
    memberCount: Number(r.member_count ?? 0),
    txCount: Number(r.tx_count ?? 0),
    lastActive: r.last_active,
    isOpen: Boolean(r.is_open),
  }))
}

/** ต่ออายุเป็นจำนวนวัน — คืนวันหมดอายุใหม่ */
export async function adminExtendShop(shopId, days) {
  return unwrap(supabase.rpc('admin_extend_shop', { p_shop: shopId, p_days: Number(days) }))
}

/**
 * เปลี่ยนสถานะร้าน
 * @param opts.status 'trial' | 'active' | 'suspended' | 'closed'
 * @param opts.expiresAt ISO string หรือ null (= ไม่มีวันหมดอายุ)
 * @param opts.reason บังคับกรอกเมื่อ status = 'suspended'
 * @param opts.keepExpires true = ไม่แตะวันหมดอายุเดิม
 */
export async function adminSetShopAccess(shopId, { status, expiresAt = null, reason = null, keepExpires = false }) {
  await unwrap(
    supabase.rpc('admin_set_shop_access', {
      p_shop: shopId,
      p_status: status,
      p_expires: expiresAt,
      p_reason: reason,
      p_keep_expires: keepExpires,
    })
  )
}

export async function adminListAudit({ shopId = null, limit = 200 } = {}) {
  let q = supabase
    .from('admin_audit_log')
    .select('id, admin_email, shop_id, action, detail, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (shopId) q = q.eq('shop_id', shopId)
  return unwrap(q)
}

export async function adminListResetRequests() {
  return unwrap(
    supabase
      .from('password_reset_requests')
      .select('id, email, note, status, created_at, handled_at, claimed_phone, reason')
      .order('created_at', { ascending: false })
      .limit(200)
  )
}

export async function adminCloseResetRequest(id, status) {
  await unwrap(supabase.rpc('admin_close_reset_request', { p_id: id, p_status: status }))
}

// ── บัญชีผู้ใช้ (ระบบล็อกอินของเราเอง — users.sql หมวด 11) ───────────────

/**
 * ตั้งรหัสผ่านให้ผู้ใช้ — คืนรหัสที่ตั้งจริง (ฐานเก็บแค่แฮช จึงเห็นได้ครั้งเดียว)
 * @param opts.password   รหัสที่แอดมินพิมพ์เอง — เว้นว่าง = ให้ฐานข้อมูลสุ่มให้
 * @param opts.mustChange true (ปริยาย) = ผู้ใช้ต้องตั้งรหัสของตัวเองทันทีที่เข้า
 */
export async function adminIssueTempPassword(userId, { password = null, mustChange = true } = {}) {
  return unwrap(
    supabase.rpc('admin_issue_temp_password', {
      p_user: userId,
      p_password: password?.trim() || null,
      p_must_change: Boolean(mustChange),
    })
  )
}

export async function adminSetUserActive(userId, active) {
  await unwrap(supabase.rpc('admin_set_user_active', { p_user: userId, p_active: Boolean(active) }))
}

/** เตะออกจากทุกเครื่อง — คืนจำนวนตั๋วที่ถูกถอน */
export async function adminKickUser(userId) {
  return unwrap(supabase.rpc('admin_kick_user', { p_user: userId }))
}

/**
 * แก้ข้อมูลกู้บัญชีของลูกค้า (ชื่อ · วันเกิด · เบอร์)
 *
 * ใช้กับบัญชีที่ถูกสร้างข้ามหน้าสมัคร (เช่นตอนย้ายระบบ) ซึ่งไม่มีวันเกิด/เบอร์
 * จึงกู้รหัสเองไม่ได้ — ช่องไหนเว้นว่างคือไม่แตะของเดิม
 */
export async function adminSetUserIdentity(userId, { displayName = null, birthDate = null, phone = null } = {}) {
  await unwrap(
    supabase.rpc('admin_set_user_identity', {
      p_user: userId,
      p_display_name: displayName?.trim() || null,
      p_birth_date: birthDate || null,
      p_phone: phone?.trim() || null,
    })
  )
}

/** แก้ค่าตั้งของแพลตฟอร์ม (จำนวนวันทดลอง / เปิด-ปิดรับสมัคร) */
export async function adminSavePlatformSettings({ trialDays, signupOpen, signupNote }) {
  await unwrap(
    supabase
      .from('platform_settings')
      .update({
        trial_days: Number(trialDays),
        signup_open: Boolean(signupOpen),
        signup_note: signupNote?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)
  )
}
