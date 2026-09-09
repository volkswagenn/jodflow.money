import { useEffect, useState } from 'react'
import { adminSavePlatformSettings, loadPlatformSettings } from '../../lib/api/platform'

/**
 * ค่าตั้งระดับแพลตฟอร์ม — เก็บในฐานข้อมูล ไม่ใช่ตัวแปร env
 *
 * เพราะสองค่านี้เป็นเรื่องที่ "อยากเปลี่ยนตอนนี้เลย" (ปิดรับสมัครชั่วคราวเพราะเซิร์ฟเวอร์
 * มีปัญหา / ยืดวันทดลองช่วงจัดโปร) ถ้าอยู่ใน env ต้องแก้แล้ว deploy ใหม่ทุกครั้ง
 * ซึ่งช้าเกินกว่าจะทันสถานการณ์ที่ต้องใช้มันจริง
 */
export default function PlatformSettings() {
  const [form, setForm] = useState(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    loadPlatformSettings()
      .then((s) => alive && setForm(s))
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [])

  async function save() {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await adminSavePlatformSettings(form)
      setSaved(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (error && !form) return <div className="card px-[18px] py-5 text-body text-expense">{error}</div>
  if (!form) return <div className="card px-[18px] py-8 text-center text-label text-faint">กำลังโหลด…</div>

  return (
    <div className="card px-[18px] py-5 flex flex-col gap-4 max-w-[520px]">
      <div>
        <label className="label">ทดลองใช้ฟรีกี่วัน</label>
        <input
          className="input"
          type="number"
          min={0}
          max={3650}
          value={form.trialDays}
          onChange={(e) => setForm((f) => ({ ...f, trialDays: e.target.value }))}
        />
        <p className="text-[11.5px] text-faint mt-1.5 leading-relaxed">
          มีผลกับคนที่สมัคร <b className="text-ink">หลังจากนี้</b> เท่านั้น — ลูกค้าเดิมที่กำลังทดลองอยู่
          วันหมดอายุไม่ขยับ ถ้าอยากยืดให้เขาด้วย ใช้ปุ่มต่ออายุในแท็บลูกค้า
        </p>
      </div>

      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          className="mt-1"
          checked={form.signupOpen}
          onChange={(e) => setForm((f) => ({ ...f, signupOpen: e.target.checked }))}
        />
        <span>
          <span className="text-[13px] font-medium">เปิดรับสมัครสมาชิกใหม่</span>
          <span className="block text-[11.5px] text-faint leading-relaxed mt-0.5">
            ปิดแล้วปุ่มสมัครจะหายจากหน้าล็อกอิน และต่อให้ยิงตรงเข้ามาก็สร้างร้านไม่ได้
            (ฐานข้อมูลปฏิเสธให้อีกชั้น) ลูกค้าเดิมยังใช้งานได้ตามปกติ
          </span>
        </span>
      </label>

      <div>
        <label className="label">ข้อความบนหน้าสมัคร</label>
        <input
          className="input"
          value={form.signupNote ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, signupNote: e.target.value }))}
          placeholder="เช่น ช่วงนี้เปิดรับเฉพาะลูกค้าที่ได้รับเชิญ"
        />
      </div>

      {error && <p className="text-label text-expense">{error}</p>}
      {saved && <p className="text-label text-income">บันทึกแล้ว</p>}

      <div>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </div>
    </div>
  )
}
