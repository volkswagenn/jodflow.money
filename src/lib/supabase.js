import { createClient } from '@supabase/supabase-js'
import { PASSWORD_PROBLEM_TEXT } from './passwordRules'
import { getSessionToken } from './sessionToken'

// ค่าทั้งสองตัวถูกฝังลงไฟล์ที่เบราว์เซอร์โหลด = เป็นข้อมูลสาธารณะ ไม่ใช่ความลับ
// ความปลอดภัยจริงอยู่ที่ RLS ใน supabase/policies.sql
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// ล้มตั้งแต่ตอนโหลดไฟล์ พร้อมข้อความที่บอกว่าต้องทำอะไร ดีกว่าปล่อยให้ไป error
// ตอนยิง request แล้วอ่านไม่ออกว่าเกิดจากอะไร
// ค่าที่ยังเป็นตัวอย่างจาก .env.example ให้ถือว่ายังไม่ได้ตั้งค่า ไม่งั้นจะไป error
// ตอนยิง request แล้วขึ้นว่า "ต่อเน็ตไม่ได้" ซึ่งทำให้หลงทาง
const isPlaceholder = (v) => !v || v.includes('xxxxxxxxxxxx') || v === 'eyJhbGciOi...'

/**
 * ตั้งค่ายังไม่ครบหรือเปล่า — ถ้าใช่จะเป็นข้อความบอกวิธีแก้
 *
 * ตั้งใจไม่ throw ตรงนี้ เพราะไฟล์นี้ถูก import ตั้งแต่ตอนแอปเริ่มโหลด
 * ถ้า throw หน้าเว็บจะขาวเปล่าโดยไม่มีอะไรบอก → ให้ AuthGate เอาค่านี้ไปแสดงเป็นหน้าจอแทน
 */
export const configError = (isPlaceholder(url) || isPlaceholder(anonKey))
  ? 'ยังไม่ได้ใส่ค่า Supabase ในไฟล์ .env.local'
  : null

/**
 * ระบบล็อกอินเป็นของเราเอง (ดู supabase/users.sql หมวด 3) — ไม่ใช้ Supabase Auth
 *
 * ตั๋วถูกส่งไปกับทุก request ใน header x-session-token ผ่าน fetch ตัวนี้
 * ฝั่งฐานข้อมูล pre-request hook อ่าน header → หา session → ตั้ง auth.uid() ให้เป็นคนของเรา
 * ครอบ fetch แทนการตั้ง global.headers เพราะตั๋วเปลี่ยนได้ระหว่างใช้งาน (ล็อกอิน/ออก)
 * แต่ client ถูกสร้างครั้งเดียวตอนโหลดไฟล์ — headers คงที่ตามไม่ทัน
 *
 * ตัว fetch ตัวเดียวกันนี้ถูกใช้กับ Storage ด้วย — policy ของไฟล์แนบจึงอ่านตั๋วเดียวกัน
 */
function fetchWithSession(input, init = {}) {
  const token = getSessionToken()
  if (!token) return fetch(input, init)
  const headers = new Headers(init.headers ?? {})
  headers.set('x-session-token', token)
  return fetch(input, { ...init, headers })
}

export const supabase = createClient(url || 'https://unset.supabase.co', anonKey || 'unset', {
  global: { fetch: fetchWithSession },
  auth: {
    // ไม่ใช้ Supabase Auth แล้ว — ปิดทุกอย่างที่มันจะแอบทำเอง (อ่าน hash ใน URL · ต่ออายุ JWT)
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
})

/**
 * แปลง error จาก Supabase เป็นข้อความไทยที่ผู้ใช้อ่านรู้เรื่อง
 * ใช้ที่ชั้น api/ ทุกที่ เพื่อให้ทั้งแอปแสดงข้อความแนวเดียวกัน
 */
export function toThaiError(error) {
  if (!error) return null
  const msg = error.message ?? String(error)

  if (error.code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return 'ไม่มีสิทธิ์ทำรายการนี้'
  }
  // 23514 = ข้อมูลผิดกติกาที่ตั้งไว้ในตาราง ข้อความดิบมีแต่ชื่อ constraint ภาษาอังกฤษ
  // ซึ่งผู้ใช้อ่านแล้วเดาไม่ออกว่าต้องแก้อะไร กติกาที่ชนบ่อยจึงแปลไว้ตรงนี้
  //
  // ส่วนใหญ่ชนเพราะฐานข้อมูลยังเป็นกติกาชุดเก่า ทั้งที่หน้าจอปล่อยให้กรอกค่าใหม่ได้แล้ว
  // จึงต้องบอกด้วยว่าให้รันไฟล์ไหนเพื่อขยับกติกาให้ตรงกับหน้าจอ
  if (error.code === '23514' || /violates check constraint/i.test(msg)) {
    if (/card_installments_months_check/.test(msg)) {
      return 'จำนวนงวดเกินที่ฐานข้อมูลยอมรับ — ฐานข้อมูลยังจำกัดไว้ 60 งวด เปิด Supabase แล้วรัน supabase/card.sql เพื่อขยายเป็น 120 งวด ข้อมูลเดิมไม่หาย'
    }
    if (/status_check/.test(msg)) {
      return 'สถานะที่ส่งไปไม่อยู่ในชุดที่ฐานข้อมูลรู้จัก — รัน supabase/card.sql และ supabase/recurring.sql ให้ครบก่อน ข้อมูลเดิมไม่หาย'
    }
    if (/method_check/.test(msg)) {
      return 'วิธีจ่ายที่ส่งไปไม่อยู่ในชุดที่ฐานข้อมูลรู้จัก — รัน supabase/card.sql ข้อมูลเดิมไม่หาย'
    }
    return `ข้อมูลไม่ผ่านกติกาของฐานข้อมูล — ${msg}`
  }
  // PGRST204 = ส่งคอลัมน์ที่ตารางยังไม่มี แปลว่าโค้ดใหม่ถูก deploy ไปแล้วแต่ยังไม่ได้
  // อัปเดตโครงสร้างฐานข้อมูล — ข้อความดิบเป็นภาษาอังกฤษที่ผู้ใช้เดาทางแก้ไม่ออกเลย
  if (error.code === 'PGRST204' || /Could not find the .* column|schema cache/i.test(msg)) {
    // บอกชื่อสิ่งที่ขาดไปเลย — "ฐานข้อมูลยังไม่ได้อัปเดต" เฉยๆ ผู้ใช้จะเถียงว่ารันแล้ว
    // (ซึ่งมักรันไฟล์เก่าที่ค้างในแท็บ) พอเห็นชื่อฟังก์ชันจะรู้ทันทีว่าไฟล์ที่รันไม่ใช่ตัวล่าสุด
    const fn = msg.match(/function\s+(?:public\.)?([a-z_]+)\s*\(/i)?.[1]
    const col = msg.match(/the '?([a-z_]+)'? column/i)?.[1]
    const what = fn ? `ฟังก์ชัน ${fn}` : col ? `คอลัมน์ ${col}` : 'บางส่วนของโครงสร้าง'
    const file = /card|statement|installment|advance/i.test(fn ?? col ?? '') ? 'supabase/card.sql' : 'supabase/check.sql'
    return `ฐานข้อมูลยังไม่มี${what} — เปิด Supabase → SQL Editor วาง ${file} ตัวล่าสุดจาก repo ทับทั้งไฟล์แล้ว Run (ถ้ารันแล้วยังขึ้น แปลว่าไฟล์ในแท็บเป็นตัวเก่า) รันซ้ำได้ ข้อมูลเดิมไม่หาย`
  }
  // ── ระบบล็อกอินของเราเอง ────────────────────────────────────────────────
  // PGRST202 = เรียก RPC ที่ยังไม่มี → ยังไม่ได้รัน users.sql ตัวที่มีระบบล็อกอินใหม่
  if (error.code === 'PGRST202' || /Could not find the function public\.app_/i.test(msg)) {
    return 'ฐานข้อมูลยังไม่มีระบบล็อกอินตัวใหม่ — เปิด Supabase → SQL Editor วาง supabase/users.sql ตัวล่าสุดทั้งไฟล์แล้ว Run (รันซ้ำได้ ข้อมูลเดิมไม่หาย)'
  }
  if (/Password should be at least|weak.?password/i.test(msg)) {
    return PASSWORD_PROBLEM_TEXT.TOO_SHORT
  }
  if (/rate limit|too many requests/i.test(msg)) {
    return 'ทำรายการถี่เกินไป รอสักครู่แล้วลองใหม่'
  }
  if (/Failed to fetch|NetworkError|fetch failed/i.test(msg)) {
    return 'ต่ออินเทอร์เน็ตไม่ได้ — ระบบนี้ต้องออนไลน์ตลอดเวลา'
  }
  if (/JWT expired|refresh_token_not_found/i.test(msg)) return 'เซสชันหมดอายุ กรุณาล็อกอินใหม่'
  return msg
}

/** ครอบ query ของ supabase ให้ throw เป็นข้อความไทย แทนการคืน { data, error } */
export async function unwrap(promise) {
  const { data, error } = await promise
  if (error) throw new Error(toThaiError(error))
  return data
}
