import { useState } from 'react'
import Popup from '../../components/shared/Popup'
import { adminSetUserIdentity } from '../../lib/api/platform'
import { toDateInput } from './adminFormat'

/**
 * แก้ข้อมูลกู้บัญชีของลูกค้า — ชื่อ · วันเกิด · เบอร์
 *
 * ทำไมต้องมี: บัญชีที่ถูกสร้างข้ามหน้าสมัคร (เจ้าของร้านข้อมูลจริงตอนย้ายระบบ · บัญชีที่
 * แอดมินเปิดให้) ไม่มีสองช่องนี้ จึงกดลืมรหัสผ่านแล้วยืนยันตัวเองไม่ผ่านตลอดไป
 * ต้องมีทางเติมให้ ไม่งั้นลูกค้ากลุ่มนั้นต้องพึ่งแอดมินทุกครั้งที่ลืมรหัส
 *
 * ⚠️ สองช่องนี้รวมกันคือกุญแจกู้รหัสผ่านของบัญชีนั้น — กรอกที่นี่เท่านั้น
 *    ห้ามเขียนลงไฟล์ในโปรเจกต์ (repo เป็น public) และ audit log เก็บแค่ "แก้ช่องไหน" ไม่เก็บค่า
 */
export default function IdentityPopup({ shop, onClose, onDone }) {
  const [form, setForm] = useState({
    displayName: shop.ownerName ?? '',
    birthDate: toDateInput(shop.ownerBirthDate),
    phone: shop.ownerPhone ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function handleConfirm() {
    setError('')
    setBusy(true)
    try {
      await adminSetUserIdentity(shop.ownerId, form)
      onDone?.()
      onClose()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Popup
      title="ข้อมูลกู้บัญชีของลูกค้า"
      sub={shop.ownerEmail}
      icon="key"
      width={430}
      onClose={onClose}
      onConfirm={handleConfirm}
      confirmLabel="บันทึก"
      busy={busy}
      error={error}
    >
      <p className="text-[12px] text-muted leading-relaxed">
        วันเกิด + เบอร์ที่บันทึกไว้ คือสิ่งที่ลูกค้าใช้ยืนยันตัวตอนกดลืมรหัสผ่าน
        กรอกครบแล้วเขาจะตั้งรหัสใหม่เองได้ทันทีโดยไม่ต้องรอเรา
      </p>

      <label className="block">
        <span className="label">ชื่อที่แสดง</span>
        <input className="input" value={form.displayName} onChange={set('displayName')} />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label">วันเกิด</span>
          <input className="input" type="date" value={form.birthDate} onChange={set('birthDate')} />
        </label>
        <label className="block">
          <span className="label">เบอร์โทร</span>
          <input className="input" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} placeholder="0812345678" />
        </label>
      </div>

      <p className="text-[11px] text-faint leading-relaxed">
        เว้นช่องไหนไว้ = ไม่แตะค่าเดิมของช่องนั้น · ควรยืนยันตัวตนลูกค้าด้วยคนก่อนแก้ทุกครั้ง
      </p>
    </Popup>
  )
}
