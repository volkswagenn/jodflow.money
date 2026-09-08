/**
 * สีของปุ่มการกระทำทั้งแอป
 *
 * กติกาเดียวทั้งระบบ: สีเดียวกันต้องแปลว่าเรื่องเดียวกันเสมอ กวาดตาเห็นสีก่อนอ่านคำ
 *   เขียว   in     เงินเข้าที่นี่ (ฝาก รับเงิน จ่ายแล้ว)
 *   แดง     out    เงินออกจากที่นี่ (ถอน จ่าย กดเงินสด)
 *   น้ำเงิน move   ย้ายที่เก็บ ยอดรวมทั้งร้านไม่เปลี่ยน (โอน ย้ายรอบบิล)
 *   น้ำตาล  pocket กระเป๋าตังค์ย่อย — กันเงินไว้ ยืม-คืน
 *   เหลือง  wait   ค้าง รอ หรือย้อนของที่ทำไปแล้ว
 *   ม่วง    plan   ผูกพันระยะยาว — ผ่อนชำระ บัตรเครดิต รายการประจำ
 *   เทา     info   แค่เปิดดู ไม่ขยับเงินสักบาท
 *   แดงเข้ม danger ลบทิ้ง ยกเลิก
 *
 * ทำไมผูกสีกับ "ไอคอน" เป็นค่าตั้งต้น
 *   เมนูในแอปมีหลายสิบปุ่มกระจายหลายไฟล์ ถ้าให้แต่ละที่ระบุสีเอง วันหนึ่งปุ่มถอนเงิน
 *   สองที่จะคนละสีแน่นอน ผูกกับไอคอนแปลว่า "ถอนเงิน" ที่ไหนก็แดงเหมือนกันหมด
 *   ที่ไหนไม่ตรงกับกติกาค่อยใส่ tone เองทับ (ดู toneFor)
 */

/**
 * แต่ละโทนมีสามชุด
 *   chip/icon  พื้นอ่อน + ไอคอนสีเข้ม — ใช้กับปุ่มสี่เหลี่ยมในเมนู
 *   solid      พื้นทึบ + ไอคอนขาว — ใช้กับไอคอนหัวป๊อปอัป ให้น้ำหนักเท่าเดิมกับของเดิม
 *              ที่เป็นสี่เหลี่ยมสีเข้ม แต่บอกได้ด้วยว่าป๊อปอัปนี้กำลังจะทำอะไรกับเงิน
 *   hover      สีตอนเอาเมาส์ชี้
 */
export const ACTION_TONES = {
  in: {
    chip: 'bg-income-soft',
    icon: 'text-income',
    solid: 'bg-income text-white',
    hover: 'hover:bg-income-soft hover:border-income',
  },
  out: {
    chip: 'bg-expense-soft',
    icon: 'text-expense',
    solid: 'bg-expense text-white',
    hover: 'hover:bg-expense-soft hover:border-expense',
  },
  move: {
    chip: 'bg-transfer-soft',
    icon: 'text-transfer',
    solid: 'bg-transfer text-white',
    hover: 'hover:bg-transfer-soft hover:border-transfer',
  },
  pocket: {
    chip: 'bg-pocket-soft',
    icon: 'text-pocket',
    solid: 'bg-pocket text-white',
    hover: 'hover:bg-pocket-soft hover:border-pocket',
  },
  wait: {
    chip: 'bg-pending-soft',
    icon: 'text-pending',
    solid: 'bg-pending text-white',
    hover: 'hover:bg-pending-soft hover:border-pending',
  },
  plan: {
    chip: 'bg-recurring-soft',
    icon: 'text-recurring',
    solid: 'bg-recurring text-white',
    hover: 'hover:bg-recurring-soft hover:border-recurring',
  },
  info: {
    chip: 'bg-[#F4F3EF]',
    icon: 'text-[#5C6068]',
    solid: 'bg-ink text-white',
    hover: 'hover:bg-[#F2FAD9] hover:border-ink',
  },
  danger: {
    chip: 'bg-expense-soft',
    icon: 'text-expense',
    label: 'text-expense',
    solid: 'bg-expense text-white',
    hover: 'hover:bg-expense-soft hover:border-expense',
  },
}

/** ไอคอน → ความหมาย (ค่าตั้งต้นของสี) */
const TONE_BY_ICON = {
  // เงินเข้า
  south_west: 'in',
  arrow_downward: 'in',
  add: 'in',
  check_circle: 'in',
  // เงินออก
  north_east: 'out',
  arrow_upward: 'out',
  payments: 'out',
  // ย้ายที่เก็บ
  swap_horiz: 'move',
  account_balance: 'move',
  // กระเป๋าย่อย
  savings: 'pocket',
  handshake: 'pocket',
  // ค้าง / ย้อน
  pending_actions: 'wait',
  schedule: 'wait',
  undo: 'wait',
  // ผูกพันระยะยาว
  credit_card: 'plan',
  event_repeat: 'plan',
  // ลบ / ยกเลิก
  delete: 'danger',
  delete_sweep: 'danger',
  cancel: 'danger',
  close: 'danger',
}

/**
 * สีของปุ่มหนึ่งอัน
 * @param icon   ชื่อไอคอน Material Symbols
 * @param tone   ระบุเองทับค่าตั้งต้น (ชื่อคีย์ใน ACTION_TONES)
 * @param danger ปุ่มทำลายของ — ชนะทุกอย่าง
 */
export function toneFor({ icon, tone, danger } = {}) {
  if (danger) return ACTION_TONES.danger
  return ACTION_TONES[tone] ?? ACTION_TONES[TONE_BY_ICON[icon]] ?? ACTION_TONES.info
}
