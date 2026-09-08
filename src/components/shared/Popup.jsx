import { useEffect } from 'react'
import Icon from './Icon'
import { toneFor } from '../../lib/actionTone'

/**
 * เปลือกของป๊อปอัปทุกตัวในแอป
 *
 * ก่อนหน้านี้แต่ละป๊อปอัปเขียนหัว/ท้าย/ปุ่มของตัวเอง ทำให้ความสูง สี ระยะขอบ
 * และตำแหน่งปุ่มไม่ตรงกันสักอัน ผู้ใช้ต้องมองหาปุ่มยืนยันใหม่ทุกครั้ง
 * ตัวนี้กำหนดโครงเดียว: หัว (ไอคอน + ชื่อ + คำอธิบาย + ปิด) → เนื้อหา → ท้าย (ยกเลิก + ยืนยัน)
 *
 * props
 *   title, sub   – ข้อความบนหัว
 *   icon         – ชื่อไอคอน Material Symbols บนสี่เหลี่ยมหัวกล่อง
 *   tone         – สีของสี่เหลี่ยมนั้นตามความหมาย ('in' 'out' 'move' 'pocket' 'wait' 'plan' 'info')
 *                  ไม่ส่งมาก็เดาจากไอคอนให้เอง
 *   headTone     – 'default' | 'note' | 'danger' — สีพื้นของแถบหัว
 *   width        – ความกว้างสูงสุดของกล่อง (ค่าเริ่มต้น 460px)
 *   onClose      – ปิด (กากบาท / ปุ่มยกเลิก / กด Esc / คลิกนอกกล่อง)
 *   onConfirm    – กดปุ่มยืนยัน; ไม่ส่งมา = ไม่มีแถบท้าย
 *   confirmLabel, cancelLabel, danger, busy, disabled
 *   footer       – แทนที่แถบท้ายมาตรฐานทั้งแถบเมื่อป๊อปอัปนั้นต้องการปุ่มพิเศษ
 */
const HEAD_TONES = {
  default: 'bg-[#FAF9F6]',
  note: 'bg-[#FBF6DC]',
  danger: 'bg-expense-soft',
}

export default function Popup({
  title,
  sub,
  icon = 'sticky_note_2',
  // สีของสี่เหลี่ยมไอคอนหัวกล่อง — ไม่ส่งมาก็เดาจากไอคอน (ดู lib/actionTone)
  tone,
  headTone = 'default',
  width = 460,
  onClose,
  onConfirm,
  confirmLabel = 'บันทึก',
  cancelLabel = 'ยกเลิก',
  danger = false,
  busy = false,
  disabled = false,
  error = '',
  footer,
  // แทนที่ระยะขอบมาตรฐานของตัวกล่อง — ใช้เมื่อเนื้อในมีระยะขอบของตัวเองอยู่แล้ว
  // (เช่นยกฟอร์มทั้งหน้ามาใส่ในป๊อปอัป) ไม่งั้นจะได้ขอบซ้อนสองชั้น
  bodyClassName = 'px-[17px] py-[15px] flex flex-col gap-[11px]',
  children,
}) {
  // ปิดด้วย Esc — ป๊อปอัปที่กดพลาดต้องออกได้โดยไม่ต้องหาปุ่ม
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[70] bg-ink/[0.46] flex items-center justify-center p-4 sm:p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div
        className="w-full bg-white rounded-[18px] shadow-[0_18px_60px_rgba(22,24,29,.34)] flex flex-col overflow-hidden max-h-full"
        style={{ maxWidth: width }}
      >
        <div className={`flex-none flex items-center gap-[11px] px-[17px] py-[13px] border-b border-[#EFEDE7] ${HEAD_TONES[headTone] ?? HEAD_TONES.default}`}>
          {/* สี่เหลี่ยมไอคอนบอกตั้งแต่แรกเห็นว่าป๊อปอัปนี้จะทำอะไรกับเงิน — เขียวเข้า แดงออก
              น้ำเงินย้าย น้ำตาลกระเป๋าย่อย (ดู lib/actionTone) ป๊อปอัปที่ไม่ได้ยุ่งกับเงิน
              ยังเป็นสี่เหลี่ยมเข้มเหมือนเดิม จะได้ไม่ใส่สีจนสีหมดความหมาย */}
          <span className={`w-[30px] h-[30px] flex-none rounded-[9px] flex items-center justify-center ${
            toneFor({ icon, tone, danger: danger || headTone === 'danger' }).solid
          }`}>
            <Icon name={icon} size={17} />
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-ink truncate">{title}</div>
            {sub && <div className="text-[11.5px] text-faint truncate">{sub}</div>}
          </div>
          <button
            onClick={onClose}
            className="ml-auto w-[30px] h-[30px] flex-none rounded-[9px] flex items-center justify-center text-faint hover:bg-ink/[0.07] hover:text-ink"
            title="ปิด"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className={`flex-1 min-h-0 overflow-y-auto ${bodyClassName}`}>
          {children}
          {error && (
            <p className="text-[12.5px] text-expense bg-expense-soft border border-[#F0C4BE] rounded-ctl px-3.5 py-2.5">
              {error}
            </p>
          )}
        </div>

        {footer !== undefined ? footer : onConfirm && (
          <div className="flex-none flex items-center gap-2 justify-end px-[17px] py-3 border-t border-[#EFEDE7] bg-[#FAF9F6]">
            <button
              onClick={onClose}
              disabled={busy}
              className="h-[38px] px-4 rounded-[11px] border border-hairline bg-white text-[13px] font-semibold hover:bg-paper disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              onClick={onConfirm}
              disabled={busy || disabled}
              className={`h-[38px] px-[18px] rounded-[11px] text-white text-[13px] font-semibold hover:brightness-110 disabled:opacity-50 ${
                danger ? 'bg-expense' : 'bg-ink'
              }`}
            >
              {busy ? 'กำลังบันทึก…' : confirmLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
