import { useEffect, useState } from 'react'
import Icon from './Icon'

/**
 * แถบแจ้งเตือนข้อผิดพลาดที่ "หลุด" ออกมาโดยไม่มีใครรับ
 *
 * ทำไมต้องมี: หน้าจอหลายที่ในแอปเรียก action ของ store แบบไม่ await (เช่น
 * `updateItem(id, data)` ใน onClick) ซึ่งเป็นมรดกจากสมัยที่ store ทำงานแบบ
 * synchronous ในเครื่อง พอย้ายมาเป็น async ที่คุยกับเซิร์ฟเวอร์ การไม่ await
 * แปลว่าถ้าเซิร์ฟเวอร์ปฏิเสธ (ไม่มีสิทธิ์ / เน็ตหลุด / ข้อมูลชนกัน) จะไม่มีอะไร
 * ขึ้นบนหน้าจอเลย ผู้ใช้เห็นว่ากดแล้วเงียบ แล้วเข้าใจว่าบันทึกสำเร็จ
 *
 * ตัวนี้ดักที่ระดับ window จึงครอบทุกจุดพร้อมกัน — ไม่ได้แทนการ try/catch
 * ตรงจุด (จุดสำคัญอย่างการจ่ายเงิน/ยกเลิกรายการแก้ไปแล้วโดยตรง) แต่เป็นตาข่าย
 * กันไม่ให้มีความล้มเหลวเงียบๆ หลงเหลืออยู่
 */
export default function ErrorToast() {
  const [message, setMessage] = useState('')
  // หัวข้อเฉพาะกรณีงานหลักสำเร็จแล้ว (ดู paymentSlipFiles) · ว่าง = ทำรายการไม่สำเร็จจริง
  const [title, setTitle] = useState('')

  useEffect(() => {
    function onRejection(event) {
      const reason = event.reason
      const text = reason?.message ?? (typeof reason === 'string' ? reason : '')
      if (!text) return
      setTitle('')
      setMessage(text)
      // ยังปล่อยให้ขึ้น console ตามปกติ เพื่อให้ตอนไล่บั๊กยังเห็น stack เต็มๆ
      console.error('งานเบื้องหลังล้มเหลว:', reason)
    }
    function onWarning(event) {
      setTitle(event.detail?.title ?? '')
      setMessage(event.detail?.message ?? '')
    }
    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('app-warning', onWarning)
    return () => {
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('app-warning', onWarning)
    }
  }, [])

  // ปิดเองใน 8 วินาที — นานพอให้อ่านทัน แต่ไม่ค้างบังหน้าจอ
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(''), title ? 15000 : 8000)
    return () => clearTimeout(timer)
  }, [message, title])

  if (!message) return null

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] w-[min(92vw,460px)]">
      <div className="flex items-start gap-2.5 rounded-panel bg-expense-soft border border-expense/30 px-4 py-3 shadow-card">
        <Icon name="error" size={18} className="text-expense flex-none mt-px" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-expense">{title || 'ทำรายการไม่สำเร็จ'}</p>
          <p className="text-[12.5px] text-expense/90 mt-0.5 break-words">{message}</p>
        </div>
        <button
          onClick={() => setMessage('')}
          className="flex-none text-expense/60 hover:text-expense text-lg leading-none"
          aria-label="ปิด"
        >
          ×
        </button>
      </div>
    </div>
  )
}
