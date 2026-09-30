import useAppStore from '../store/useAppStore'
import useWalletStore from '../store/useWalletStore'

/**
 * ด่านกลางก่อนตัดเงินออกจากแหล่งใดแหล่งหนึ่ง
 *
 * ทำไมต้องเป็นด่านเดียว: ของเดิมแต่ละหน้าเช็คยอดติดลบกันเอง ผลคือบันทึกรายจ่ายกับ
 * จ่ายบิลประจำมีเตือน แต่จ่ายบิลบัตร งวดผ่อน หนี้ และรายการค้างชำระไม่มีเช็คเลย
 * กติกาเรื่องเงินต้องเหมือนกันทุกทางออก ไม่งั้นคนจะพบว่า "ทางนี้กันไว้ แต่ทางนั้นทะลุได้"
 *
 * พฤติกรรมตามค่าตั้งของร้าน (allowNegativeBalance ใน shop_settings)
 *   ไม่อนุญาต  → ป๊อปอัป "เงินไม่พอจ่าย" ไม่มีปุ่มยืนยัน — คืน false เสมอ
 *   อนุญาต     → ป๊อปอัปเตือนว่ายอดจะติดลบเท่าไร ให้เลือกจ่ายต่อหรือยกเลิก
 *
 * บัตรเครดิตและ "ค้างชำระ" ไม่ผ่านด่านนี้ — ทั้งสองอย่างไม่ได้ตัดเงินจากที่ไหน
 */

/** หน้าต่างป๊อปอัปที่ App ติดตั้งไว้ — มีได้ตัวเดียว */
let presenter = null

export function bindBalanceGuard(fn) {
  presenter = fn
  return () => {
    if (presenter === fn) presenter = null
  }
}

/**
 * ยอดของแหล่งเงินก่อน/หลังจ่าย — คืน null ถ้าวิธีจ่ายนี้ไม่ได้ตัดเงินจากแหล่งที่มียอด
 * @param method 'cash' | 'transfer' | 'sub' | อื่นๆ
 */
export function balanceAfter({ method, amount, accountId = null, subWalletId = null }) {
  const store = useWalletStore.getState()
  const pay = Number(amount) || 0

  if (subWalletId) {
    const sub = store.subWallets.find((w) => w.id === subWalletId)
    return sub ? { label: `กระเป๋า "${sub.name}"`, balance: Number(sub.balance) || 0, amount: pay } : null
  }
  if (method === 'cash') {
    return { label: 'เงินสด', balance: Number(store.cash) || 0, amount: pay }
  }
  if (method === 'transfer') {
    // เช็คยอดของบัญชีที่ถูกเลือก ไม่ใช่ยอดรวมทุกบัญชี
    const id = store.resolveTransferAccountId(accountId)
    const account = store.transferAccounts.find((a) => a.id === id)
    return account ? { label: `บัญชี "${account.name}"`, balance: Number(account.balance) || 0, amount: pay } : null
  }
  return null
}

/**
 * ถามก่อนตัดเงิน — resolve เป็น true เมื่อจ่ายต่อได้ false เมื่อต้องหยุด
 * ยอดพอจ่ายจะผ่านทันทีโดยไม่มีอะไรขึ้นจอ
 */
export function ensureCanPay(params) {
  const info = balanceAfter(params)
  if (!info || info.amount <= 0) return Promise.resolve(true)

  // ปัดสองตำแหน่งก่อนเทียบ กันเศษทศนิยมของ JS ทำให้ "จ่ายพอดียอด" กลายเป็นติดลบ 0.0000001
  const after = Math.round((info.balance - info.amount) * 100) / 100
  if (after >= 0) return Promise.resolve(true)

  const allow = useAppStore.getState().allowNegativeBalance
  // ไม่มีหน้าต่างให้ถาม (ไม่ควรเกิด) — ยึดค่าตั้ง: อนุญาตก็ผ่าน ไม่อนุญาตก็หยุด
  if (!presenter) return Promise.resolve(Boolean(allow))

  return new Promise((resolve) => presenter({ ...info, after, allow: Boolean(allow), resolve }))
}

/**
 * ข้อผิดพลาดที่แปลว่า "ผู้ใช้ไม่ได้จ่ายต่อ" — ข้อความว่างโดยตั้งใจ
 *
 * ด่านนี้ถูกเรียกจากใน store action ซึ่งหน้าจอหลายที่ await อยู่แล้วค่อยปิดหน้าต่างจ่าย
 * การ throw ทำให้โค้ดหลัง await ไม่ทำงาน หน้าต่างจ่ายจึงยังเปิดอยู่ให้เปลี่ยนแหล่งเงินได้
 * ส่วนข้อความว่างทำให้ทั้ง ErrorToast และ setError(err.message) ของแต่ละหน้าไม่ขึ้นอะไรซ้ำ
 * (ป๊อปอัปของด่านนี้บอกเหตุผลไปแล้ว)
 */
export class PaymentAborted extends Error {
  constructor() {
    super('')
    this.name = 'PaymentAborted'
  }
}

/** ใช้ใน store action: ผ่านก็เงียบ ไม่ผ่านก็ throw PaymentAborted */
export async function assertCanPay(params) {
  if (!(await ensureCanPay(params))) throw new PaymentAborted()
}
