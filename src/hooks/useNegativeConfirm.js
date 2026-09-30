import { ensureCanPay } from '../lib/balanceGuard'

/**
 * ตัวเชื่อมของหน้าที่เขียนไว้ก่อนมีด่านกลาง (บันทึกรายจ่าย · หน้ากระเป๋าเงิน)
 *
 * คงรูปแบบเดิม { warning, check, proceed, cancel } ไว้ หน้าพวกนั้นจึงไม่ต้องแก้
 * แต่การตัดสินและป๊อปอัปย้ายไปอยู่ที่ lib/balanceGuard ทั้งหมด — warning จึงเป็น null เสมอ
 * และป๊อปอัปยืนยันเก่าของแต่ละหน้าจะไม่ถูกเปิดอีก กติกา "ห้ามติดลบ / เตือนแล้วจ่ายต่อ"
 * จึงเหมือนกันทุกหน้าโดยอัตโนมัติ
 */
export function useNegativeConfirm() {
  const check = ({ method, amount, subWalletId, accountId, onConfirm }) => {
    ensureCanPay({ method, amount, subWalletId, accountId }).then((ok) => {
      if (ok) onConfirm()
    })
  }
  return { warning: null, check, proceed: () => {}, cancel: () => {} }
}
