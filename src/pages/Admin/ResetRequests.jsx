import { useCallback, useEffect, useState } from 'react'
import Icon from '../../components/shared/Icon'
import { adminCloseResetRequest, adminListResetRequests } from '../../lib/api/platform'
import { thaiDateTime } from './adminFormat'

/**
 * คิวคำขอรีเซ็ตรหัสผ่าน
 *
 * หน้านี้ตั้งรหัสใหม่ให้ไม่ได้โดยตั้งใจ — การเปลี่ยนรหัสของ "คนอื่น" ต้องใช้
 * service_role key ซึ่งถ้าเอามาไว้ในเว็บ ใครเปิด DevTools ก็ยึดฐานข้อมูลได้ทั้งก้อน
 * จึงเหลือทางเดียวที่ปลอดภัย: ทำที่แดชบอร์ด Supabase แล้วกลับมากดว่าจัดการแล้ว
 */
export default function ResetRequests() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const reload = useCallback(() => {
    setError('')
    return adminListResetRequests()
      .then(setRows)
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function close(id, status) {
    setBusyId(id)
    try {
      await adminCloseResetRequest(id, status)
      await reload()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusyId(null)
    }
  }

  const pending = (rows ?? []).filter((r) => r.status === 'pending')
  const handled = (rows ?? []).filter((r) => r.status !== 'pending')

  return (
    <div className="flex flex-col gap-3.5">
      <div className="card px-[18px] py-4">
        <div className="text-[13.5px] font-semibold mb-1.5">วิธีตั้งรหัสใหม่ให้ลูกค้า</div>
        <ol className="text-[12px] text-muted leading-relaxed space-y-1 list-decimal pl-4">
          <li><b className="text-ink">ยืนยันตัวตนด้วยคนก่อน</b> — โทรกลับตามเบอร์ที่ลูกค้าอ้าง เทียบกับเบอร์/ชื่อที่เห็นในแท็บลูกค้า</li>
          <li>ไปแท็บ <b className="text-ink">ลูกค้า</b> → หาร้านของอีเมลนั้น → <b className="text-ink">ออกรหัสชั่วคราว</b> (คำขอในหน้านี้ถูกปิดให้เองเมื่อออกรหัส)</li>
          <li>แจ้งรหัสให้ลูกค้า — เข้าด้วยรหัสนั้นแล้วระบบบังคับตั้งรหัสใหม่ทันที ไม่ต้องบอกอะไรเพิ่ม</li>
          <li>คำขอที่มีเหตุผล "ยืนยันเองไม่ผ่าน" หลายครั้งติดกันจากอีเมลเดียว = อาจมีคนพยายามเดา ควรโทรถามเจ้าของบัญชี</li>
        </ol>
      </div>

      {error && <div className="card px-[18px] py-4 text-body text-expense">{error}</div>}

      {rows === null && <div className="card px-[18px] py-8 text-center text-label text-faint">กำลังโหลด…</div>}

      {rows !== null && pending.length === 0 && (
        <div className="card px-[18px] py-10 text-center">
          <Icon name="check_circle" size={30} className="text-income mx-auto" />
          <p className="text-body text-muted mt-2">ไม่มีคำขอค้างอยู่</p>
        </div>
      )}

      {pending.map((r) => (
        <div key={r.id} className="card px-[18px] py-4 flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-[200px]">
            <div className="text-[13.5px] font-semibold break-all">{r.email}</div>
            <div className="text-[11.5px] text-faint mt-0.5">
              ส่งเมื่อ {thaiDateTime(r.created_at)}{r.claimed_phone ? ` · เบอร์ที่กรอกมา ${r.claimed_phone}` : ''}
            </div>
            {r.note && <div className="text-[12px] text-muted mt-1.5 leading-relaxed">{r.note}</div>}
          </div>
          <div className="flex gap-1.5">
            <button
              className="btn btn-primary h-9 px-3 text-[12.5px]"
              disabled={busyId === r.id}
              onClick={() => close(r.id, 'done')}
            >
              จัดการแล้ว
            </button>
            <button
              className="btn btn-secondary h-9 px-3 text-[12.5px]"
              disabled={busyId === r.id}
              onClick={() => close(r.id, 'ignored')}
            >
              ไม่ดำเนินการ
            </button>
          </div>
        </div>
      ))}

      {handled.length > 0 && (
        <div className="card px-[18px] py-4">
          <div className="text-[13.5px] font-semibold mb-2.5">จัดการไปแล้ว</div>
          <div className="divide-y divide-[#F2F0EA]">
            {handled.map((r) => (
              <div key={r.id} className="py-2 flex items-center gap-3 text-[12px]">
                <span className="flex-1 min-w-0 truncate text-muted">{r.email}</span>
                <span className="text-faint">{thaiDateTime(r.handled_at ?? r.created_at)}</span>
                <span className={r.status === 'done' ? 'text-income' : 'text-faint'}>
                  {r.status === 'done' ? 'จัดการแล้ว' : 'ไม่ดำเนินการ'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
