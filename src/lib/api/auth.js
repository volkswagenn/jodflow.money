import { supabase, toThaiError } from '../supabase'

/**
 * ระบบล็อกอินของเราเอง — ทุกอย่างคือ RPC ใน supabase/users.sql หมวด 9-10
 *
 * RPC พวกนี้คืน jsonb { ok, error, ... } แทนการ throw (เหตุผลอยู่ในไฟล์ SQL:
 * ถ้า throw ตัวนับครั้งที่ผิดจะถูก rollback) ที่นี่แปลงกลับเป็น throw ให้หน้าจอใช้ง่าย
 * ส่วน error จาก PostgREST เอง (เช่นยังไม่ได้รัน users.sql) แปลเป็นไทยผ่าน toThaiError
 */
async function call(fn, args) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(toThaiError(error))
  return data
}

async function callOk(fn, args) {
  const data = await call(fn, args)
  if (!data?.ok) throw new Error(data?.error ?? 'ทำรายการไม่สำเร็จ')
  return data
}

/** @returns {{ token: string, user_id: string, must_change_password: boolean }} */
export async function login(email, password) {
  return callOk('app_login', { p_email: email, p_password: password })
}

/** @returns {{ token: string, user_id: string }} */
export async function signup({ email, password, displayName, shopName, birthDate, phone }) {
  return callOk('app_signup', {
    p_email: email,
    p_password: password,
    p_display_name: displayName,
    p_shop_name: shopName || null,
    p_birth_date: birthDate || null,
    p_phone: phone || null,
  })
}

/**
 * ฉันคือใคร — null = ตั๋วไม่มี/หมดอายุ/ถูกถอน/บัญชีปิด
 * นี่คือ "ชั้น 2" ตามแบบ ref: ตั๋วต้องยังมีชีวิตในฐานข้อมูล ไม่ใช่แค่มีอยู่ในเครื่อง
 */
export async function me() {
  return call('app_me')
}

export async function logout() {
  await call('app_logout')
}

export async function logoutAll() {
  await call('app_logout_all')
}

export async function changePassword(oldPassword, newPassword) {
  await callOk('app_change_password', { p_old: oldPassword, p_new: newPassword })
}

export async function updateMe({ displayName, birthDate, phone }) {
  await callOk('app_update_me', {
    p_display_name: displayName ?? null,
    p_birth_date: birthDate || null,
    p_phone: phone || null,
  })
}

export async function listMySessions() {
  return (await call('app_my_sessions')) ?? []
}

export async function revokeSession(id) {
  await call('app_revoke_session', { p_id: id })
}

/** ลืมรหัสผ่าน ขั้น 1 — ตรงครบสามได้ตั๋ว 15 นาที · ไม่ตรงได้ข้อความเดียวกันเสมอ */
export async function resetVerify({ email, birthDate, phone }) {
  const data = await callOk('app_reset_verify', { p_email: email, p_birth_date: birthDate, p_phone: phone })
  return data.reset_token
}

/** ลืมรหัสผ่าน ขั้น 2 */
export async function resetPassword(resetToken, newPassword) {
  await callOk('app_reset_password', { p_reset_token: resetToken, p_new: newPassword })
}
