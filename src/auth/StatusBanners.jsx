import Icon from '../components/shared/Icon'
import { useAuth } from './AuthProvider'

/**
 * แถบแดงเตือนว่า "กำลังดูข้อมูลของคนอื่นอยู่"
 *
 * ต้องแดงและอยู่บนสุดตลอดเวลา ไม่ใช่ป้ายเล็กๆ มุมจอ เพราะความผิดพลาดที่แพงที่สุด
 * ของโหมดนี้คือแอดมินลืมว่าตัวเองอยู่ในร้านลูกค้า แล้วบันทึกรายการของตัวเองลงไป
 */
export function AdminViewBanner() {
  const { isAdminView, shop, leaveShopView } = useAuth()
  if (!isAdminView) return null

  return (
    <div className="flex-none bg-expense text-white px-4 sm:px-6 py-2 flex items-center gap-2.5 text-[12.5px]">
      <Icon name="visibility" size={17} className="flex-none" />
      <span className="flex-1 min-w-0">
        กำลังดูและแก้ข้อมูลของ <b>{shop?.name}</b> ในฐานะแอดมิน — ทุกอย่างที่บันทึกมีผลกับข้อมูลจริงของลูกค้า
      </span>
      <button
        onClick={leaveShopView}
        className="flex-none h-7 px-3 rounded-ctl bg-white/20 hover:bg-white/30 font-semibold"
      >
        กลับไปข้อมูลของฉัน
      </button>
    </div>
  )
}

/**
 * แถบบอกว่าเหลือกี่วัน — ขึ้นเมื่อกำลังทดลองใช้ หรือใกล้หมดอายุ (≤ 7 วัน)
 *
 * ไม่ปิดได้โดยตั้งใจ: ถ้าปิดได้ คนที่ปิดไปจะมารู้ตัวอีกทีตอนเข้าไม่ได้แล้ว
 * ส่วนคนที่ต่ออายุแล้ว (ไม่มีวันหมด) จะไม่เห็นแถบนี้เลย จึงไม่กวนใครฟรีๆ
 */
export function TrialBanner() {
  const { shop, isAdminView, shopDaysLeft } = useAuth()

  if (isAdminView || !shop || shopDaysLeft === null) return null
  const isTrial = shop.status === 'trial'
  if (!isTrial && shopDaysLeft > 7) return null

  const urgent = shopDaysLeft <= 3
  const left =
    shopDaysLeft <= 0 ? 'วันนี้เป็นวันสุดท้าย' : `เหลืออีก ${shopDaysLeft} วัน`

  return (
    <div
      className={`flex-none px-4 sm:px-6 py-2 flex items-center gap-2.5 text-[12.5px] border-b ${
        urgent ? 'bg-expense-soft text-expense border-expense/20' : 'bg-pending-soft text-pending border-pending-line'
      }`}
    >
      <Icon name="schedule" size={17} className="flex-none" />
      <span className="flex-1 min-w-0">
        {isTrial ? 'ทดลองใช้ฟรี' : 'สิทธิ์ใช้งาน'} {left} — ต่ออายุก่อนหมด เพื่อใช้งานต่อได้ไม่สะดุด
        <span className="hidden sm:inline"> (ข้อมูลไม่หายแม้หมดอายุ)</span>
      </span>
    </div>
  )
}
