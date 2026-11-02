import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { isAttachableFile, MAX_SLIP_BYTES } from '../../lib/paymentSlipFiles'
import { slipsInstalled } from '../../lib/api/paymentSlips'

/**
 * ช่องแนบสลิปในหน้าต่างจ่ายเงิน — เลือกไฟล์ไว้ก่อน ยังไม่อัปโหลด
 *
 * ตัวไฟล์ขึ้นเซิร์ฟเวอร์หลังเงินออกสำเร็จแล้ว (ดู attachSlipFiles) ถ้าอัปโหลดตอนเลือก
 * กดยกเลิกหรือจ่ายไม่ผ่านจะเหลือไฟล์ค้างที่ไม่ได้ผูกกับการจ่ายไหนเลย
 *
 * โอนจากแอปธนาคารแล้วกดจ่ายในนี้ต่อคือจังหวะที่สลิปอยู่ในมือพอดี จึงรับทั้งเลือกไฟล์
 * ลากมาวาง และวางจากคลิปบอร์ด (จับภาพหน้าจอบนคอมแล้ว Ctrl+V ได้เลย)
 *
 * @param files    File[] ที่เลือกไว้
 * @param onChange (File[]) => void
 */
export default function SlipPicker({ files, onChange, disabled = false }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [urls, setUrls] = useState([])

  useEffect(() => {
    const next = files.map((f) => (f.type?.startsWith('image/') ? URL.createObjectURL(f) : null))
    setUrls(next)
    return () => next.forEach((u) => { if (u) URL.revokeObjectURL(u) })
  }, [files])

  const add = (incoming) => {
    const list = Array.from(incoming ?? [])
    if (list.length === 0) return
    const ok = list.filter((f) => isAttachableFile(f) && f.size <= MAX_SLIP_BYTES)
    setError(ok.length === list.length ? '' : `แนบได้เฉพาะรูปหรือ PDF ไม่เกิน ${MAX_SLIP_BYTES / 1024 / 1024} MB ต่อไฟล์`)
    if (ok.length > 0) onChange([...files, ...ok])
  }

  // วางจากคลิปบอร์ดได้ทั้งหน้าต่าง ไม่ต้องกดโฟกัสช่องนี้ก่อน
  // รับเฉพาะตอนมีไฟล์ — การวางตัวเลขลงช่องจำนวนเงินต้องทำงานตามปกติ
  useEffect(() => {
    if (disabled) return undefined
    const onPaste = (e) => {
      const pasted = Array.from(e.clipboardData?.files ?? [])
      if (pasted.length === 0) return
      e.preventDefault()
      add(pasted)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  })

  const drop = {
    onDragOver: (e) => { e.preventDefault(); setDragging(true) },
    onDragLeave: () => setDragging(false),
    onDrop: (e) => { e.preventDefault(); setDragging(false); if (!disabled) add(e.dataTransfer?.files) },
  }

  // ยังไม่ได้รัน slips.sql — ไม่โชว์ช่องที่กดแล้วจะพังทีหลัง การจ่ายเงินยังทำได้ตามปกติ
  if (!slipsInstalled()) return null

  return (
    <div className="flex-none" {...drop}>
      <label className="block text-[11.5px] text-muted mb-[5px]">สลิป / หลักฐานการโอน (ไม่บังคับ)</label>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        multiple
        accept="image/*,.pdf"
        onChange={(e) => { add(e.target.files); e.target.value = '' }}
      />

      {files.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className={`w-full min-h-11 px-3 py-2 rounded-[11px] border border-dashed flex items-center gap-2.5 text-left transition disabled:opacity-50 ${
            dragging ? 'border-ink bg-[#F2FAD9]' : 'border-[#C9C5BA] bg-[#FAF9F6] hover:border-ink hover:bg-[#F2FAD9]'
          }`}
        >
          <Icon name="upload_file" size={19} className="text-muted flex-none" />
          <span className="min-w-0">
            <span className="block text-[12.5px] font-semibold">แนบสลิป</span>
            <span className="block text-[11px] text-faint leading-snug">
              เลือกไฟล์ ลากมาวาง หรือกด Ctrl+V · แนบทีหลังได้ที่หน้าประวัติการจ่าย
            </span>
          </span>
        </button>
      ) : (
        <div className={`flex flex-wrap gap-2 rounded-[11px] p-1 -m-1 ${dragging ? 'bg-[#F2FAD9]' : ''}`}>
          {files.map((f, i) => (
            <div key={`${f.name}-${f.size}-${i}`} className="relative w-[60px] h-[76px] flex-none rounded-[10px] border border-hairline bg-paper overflow-hidden">
              {urls[i] ? (
                <img src={urls[i]} alt={f.name || `สลิป ${i + 1}`} className="w-full h-full object-cover" />
              ) : (
                <span className="w-full h-full flex items-center justify-center text-[11px] font-bold text-[#A93A2E] bg-expense-soft">PDF</span>
              )}
              <button
                type="button"
                onClick={() => onChange(files.filter((_, x) => x !== i))}
                disabled={disabled}
                aria-label={`เอา ${f.name || `สลิป ${i + 1}`} ออก`}
                title="เอาไฟล์นี้ออก"
                className="absolute top-1 right-1 w-[22px] h-[22px] rounded-full bg-ink/80 text-white flex items-center justify-center hover:bg-ink disabled:opacity-50"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
            className="w-[60px] h-[76px] flex-none rounded-[10px] border border-dashed border-[#C9C5BA] bg-[#FAF9F6] flex flex-col items-center justify-center gap-0.5 text-[10.5px] text-muted hover:border-ink hover:text-ink disabled:opacity-50"
          >
            <Icon name="add" size={18} />
            เพิ่ม
          </button>
        </div>
      )}

      {error && <p className="text-[11px] text-expense mt-1.5">{error}</p>}
    </div>
  )
}
