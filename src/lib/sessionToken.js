/**
 * ตั๋วล็อกอิน (session token) ฝั่งเบราว์เซอร์ — ทำตามแบบ Jodflow.order §2 เท่าที่ SPA ทำได้
 *
 * ต่างจาก ref ตรงเดียว: ref เก็บใน cookie httpOnly (มีเซิร์ฟเวอร์ตั้งให้) ที่นี่ไม่มีเซิร์ฟเวอร์
 * จึงเก็บใน localStorage แล้วส่งเองใน header x-session-token ทุก request
 * ⇒ JavaScript ในหน้าอ่านตั๋วได้ — เหตุผลที่ต้องไม่มีสคริปต์ภายนอกใดๆ นอกจาก Google Fonts
 *
 * สิ่งที่เหมือน ref เป๊ะ: ฐานข้อมูลเก็บแค่ sha256 ของตั๋ว · อายุ 30 วัน · ถอนตั๋วมีผลกับ
 * request ถัดไปทันที · 1 บัญชีถือได้ 2 เครื่อง (เครื่องที่ 3 เตะเครื่องเก่าสุด)
 *
 * ไฟล์นี้ตั้งใจไม่ import อะไรเลย เพราะ supabase.js ต้องอ่านตั๋วตอนสร้าง client
 * และ AuthProvider ต้องเขียนตั๋วตอนล็อกอิน — ถ้าให้ฝ่ายใดฝ่ายหนึ่งเป็นเจ้าของจะ import วนกัน
 */
const KEY = 'jf_session'

let cached = null
let loaded = false

function load() {
  if (loaded) return cached
  loaded = true
  try {
    cached = localStorage.getItem(KEY) || null
  } catch {
    cached = null // โหมดส่วนตัว / บล็อก storage → ล็อกอินได้แค่ในแท็บนี้จนกว่าจะปิด
  }
  return cached
}

export function getSessionToken() {
  return load()
}

export function setSessionToken(token) {
  cached = token || null
  loaded = true
  try {
    if (token) localStorage.setItem(KEY, token)
    else localStorage.removeItem(KEY)
  } catch {
    /* เก็บใน memory อย่างเดียว */
  }
}

export function clearSessionToken() {
  setSessionToken(null)
}

/** ตั๋วในแท็บอื่นเปลี่ยน (ล็อกอิน/ออกจากอีกแท็บ) → บอกให้แท็บนี้โหลดสถานะใหม่ */
export function onSessionTokenChange(handler) {
  const listener = (e) => {
    if (e.key !== KEY) return
    cached = e.newValue || null
    loaded = true
    handler(cached)
  }
  window.addEventListener('storage', listener)
  return () => window.removeEventListener('storage', listener)
}
