/**
 * กติการหัสผ่าน — ยกมาจาก Jodflow.order (src/lib/auth/password.ts) ให้สองระบบพูดภาษาเดียวกัน
 *
 * ที่นี่มีแค่ "กติกา" ไม่มีการแฮช — การแฮชและเทียบรหัสเป็นงานของ Supabase Auth
 * ฝั่งเซิร์ฟเวอร์ (bcrypt cost 10 เหมือนกัน) โค้ดในเบราว์เซอร์ต้องไม่แตะรหัสผ่านดิบ
 * เกินกว่าส่งไปให้ Auth
 *
 * ⚠️ ด่านนี้เป็นด่านหน้าจอ — ใครยิงตรงเข้า /auth/v1/signup ข้ามมันได้
 *    ด่านจริงต้องตั้งที่ Supabase → Authentication → Sign In / Providers → Email
 *    → "Minimum password length" ให้เท่ากับ MIN_PASSWORD_LENGTH ข้างล่างนี้
 */

/**
 * 10 ตัวเป็นแนวที่ยอมรับกันทั่วไปสำหรับระบบที่ไม่บังคับอักขระพิเศษ —
 * เลือกยาวแทนซับซ้อน เพราะรหัสที่จำไม่ได้จะจบลงที่กระดาษแปะจอ
 */
export const MIN_PASSWORD_LENGTH = 10

// รหัสที่หลุดบ่อยที่สุด — ไม่ต้องมีรายการยาวเป็นแสนคำ แค่กันชุดที่ bot ลองก่อนเสมอ
const COMMON = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwertyuiop',
  'iloveyou',
  'admin1234',
  'administrator',
  'letmein123',
  'welcome123',
])

export const PASSWORD_PROBLEM_TEXT = {
  TOO_SHORT: `รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`,
  COMMON: 'รหัสผ่านนี้ถูกใช้กันทั่วไปเกินไป เดาได้ง่าย — เปลี่ยนเป็นอย่างอื่น',
  MISMATCH: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน',
}

/** เหตุผลที่รหัสผ่านใช้ไม่ได้ ('TOO_SHORT' | 'COMMON') — null = ผ่าน */
export function checkPasswordStrength(plain) {
  if ((plain ?? '').trim().length < MIN_PASSWORD_LENGTH) return 'TOO_SHORT'
  if (COMMON.has(String(plain).toLowerCase())) return 'COMMON'
  return null
}

/**
 * ตรวจคู่ "รหัส + พิมพ์อีกครั้ง" ในที่เดียว — คืนข้อความไทยที่แสดงได้เลย หรือ null ถ้าผ่าน
 * ทุกฟอร์มที่ตั้งรหัส (สมัคร · เปลี่ยนรหัส) ใช้ตัวนี้ จะได้ไม่มีฟอร์มไหนกติกาหลวมกว่าฟอร์มอื่น
 */
export function passwordPairProblem(plain, confirm) {
  const problem = checkPasswordStrength(plain)
  if (problem) return PASSWORD_PROBLEM_TEXT[problem]
  if (plain !== confirm) return PASSWORD_PROBLEM_TEXT.MISMATCH
  return null
}
