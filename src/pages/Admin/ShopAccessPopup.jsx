import { useState } from 'react'
import Popup from '../../components/shared/Popup'
import { adminExtendShop, adminSetShopAccess } from '../../lib/api/platform'
import { endOfDayIso, expiryText, toDateInput } from './adminFormat'

const QUICK_DAYS = [7, 14, 30, 90, 365]

/**
 * เปลี่ยนสิทธิ์เข้าใช้ของลูกค้าหนึ่งราย
 *
 * แยกเป็น 3 โหมดตามสิ่งที่ตั้งใจทำจริง แทนที่จะโยนฟอร์มเดียวที่มีทุกช่องให้ดู
 * เพราะสามเรื่องนี้ทำคนละเวลาและพลาดกันคนละแบบ (ต่ออายุ = ทำบ่อย,
 * ระงับ = ต้องมีเหตุผล, กำหนดเอง = ใช้ตอนต้องแก้ให้ตรงเป๊ะ)
 *
 * ไม่ว่าโหมดไหน ฝั่งฐานข้อมูลเป็นคนคิดวันหมดอายุจริง (RPC ใน users.sql)
 * ที่นี่แค่ส่งเจตนาไป — จะได้ไม่มีทางที่หน้าจอกับฐานข้อมูลคิดคนละเลข
 */
export default function ShopAccessPopup({ shop, onClose, onDone }) {
  const [mode, setMode] = useState('extend') // extend | suspend | custom
  const [days, setDays] = useState(30)
  const [reason, setReason] = useState('')
  const [customStatus, setCustomStatus] = useState(shop.status)
  const [customDate, setCustomDate] = useState(toDateInput(shop.expiresAt))
  const [noExpiry, setNoExpiry] = useState(!shop.expiresAt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleConfirm() {
    setError('')
    setBusy(true)
    try {
      if (mode === 'extend') {
        await adminExtendShop(shop.id, days)
      } else if (mode === 'suspend') {
        if (!reason.trim()) throw new Error('ต้องกรอกเหตุผล — ลูกค้าจะเห็นข้อความนี้บนหน้าจอ')
        await adminSetShopAccess(shop.id, { status: 'suspended', reason, keepExpires: true })
      } else {
        await adminSetShopAccess(shop.id, {
          status: customStatus,
          expiresAt: noExpiry ? null : endOfDayIso(customDate),
          reason: customStatus === 'suspended' ? reason : null,
        })
      }
      onDone()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const isSuspended = shop.status === 'suspended'

  return (
    <Popup
      title={shop.name}
      sub={`${shop.ownerEmail ?? 'ไม่ทราบเจ้าของ'} · ${expiryText(shop)}`}
      icon="manage_accounts"
      width={480}
      onClose={onClose}
      onConfirm={handleConfirm}
      confirmLabel={mode === 'suspend' ? 'ระงับการใช้งาน' : 'บันทึก'}
      danger={mode === 'suspend'}
      busy={busy}
      error={error}
    >
      <div className="flex gap-1.5 flex-wrap">
        {[
          ['extend', 'ต่ออายุ'],
          ['suspend', isSuspended ? 'ระงับ (ระงับอยู่แล้ว)' : 'ระงับ'],
          ['custom', 'กำหนดเอง'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            className={`h-8 px-3.5 rounded-[9px] text-[12.5px] transition ${
              mode === key ? 'bg-ink text-white font-semibold' : 'bg-paper text-muted hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'extend' && (
        <>
          <p className="text-[12px] text-muted leading-relaxed">
            นับต่อจากวันหมดเดิมถ้ายังไม่หมด และนับจากวันนี้ถ้าหมดไปแล้ว —
            ลูกค้าที่ต่อช้าจะไม่เสียวันที่จ่ายไปฟรีๆ สถานะจะกลายเป็น "ใช้งานอยู่" ทันที
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {QUICK_DAYS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`h-9 px-3.5 rounded-ctl text-[12.5px] border transition ${
                  days === d ? 'border-ink bg-ink text-white font-semibold' : 'border-hairline text-muted hover:bg-paper'
                }`}
              >
                {d === 365 ? '1 ปี' : `${d} วัน`}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="label">หรือระบุจำนวนวันเอง</span>
            <input
              className="input"
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </label>
        </>
      )}

      {mode === 'suspend' && (
        <>
          <p className="text-[12px] text-muted leading-relaxed">
            ลูกค้าจะยังล็อกอินได้ แต่เจอหน้า "ถูกระงับ" พร้อมเหตุผลข้างล่างนี้ —
            ข้อมูลไม่ถูกลบ และวันหมดอายุเดิมไม่ถูกแตะ ปลดระงับด้วยแท็บ "กำหนดเอง"
          </p>
          <label className="block">
            <span className="label">เหตุผล (ลูกค้าเห็นข้อความนี้)</span>
            <textarea
              className="input h-auto py-2.5"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น ค้างชำระค่าบริการเดือนกันยายน กรุณาติดต่อกลับ"
            />
          </label>
        </>
      )}

      {mode === 'custom' && (
        <>
          <label className="block">
            <span className="label">สถานะ</span>
            <select className="input" value={customStatus} onChange={(e) => setCustomStatus(e.target.value)}>
              <option value="active">ใช้งานอยู่</option>
              <option value="trial">ทดลองใช้</option>
              <option value="suspended">ถูกระงับ</option>
              <option value="closed">ปิดบัญชี (ข้อมูลยังอยู่)</option>
            </select>
          </label>

          {customStatus === 'suspended' && (
            <label className="block">
              <span className="label">เหตุผล</span>
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
          )}

          <label className="flex items-center gap-2.5 text-[12.5px] cursor-pointer">
            <input type="checkbox" checked={noExpiry} onChange={(e) => setNoExpiry(e.target.checked)} />
            ไม่มีวันหมดอายุ (ใช้ได้ตลอด)
          </label>

          {!noExpiry && (
            <label className="block">
              <span className="label">ใช้ได้ถึงวันที่</span>
              <input
                className="input"
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
              />
            </label>
          )}
        </>
      )}
    </Popup>
  )
}
