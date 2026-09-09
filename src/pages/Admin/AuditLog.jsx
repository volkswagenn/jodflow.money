import { useEffect, useState } from 'react'
import Icon from '../../components/shared/Icon'
import { adminListAudit } from '../../lib/api/platform'
import { actionLabel, thaiDateTime } from './adminFormat'

/** สรุป detail เป็นข้อความสั้นๆ — ไม่ต้องให้คนอ่าน JSON ดิบเพื่อรู้ว่าเกิดอะไรขึ้น */
function describe(row) {
  const d = row.detail ?? {}
  if (row.action === 'EXTEND') {
    return `ต่อ ${d.days} วัน ถึง ${d.until ? new Date(d.until).toLocaleDateString('th-TH') : '—'}`
  }
  if (row.action === 'SET_ACCESS') {
    const from = d.from_status ?? '—'
    const to = d.to_status ?? '—'
    const exp = d.to_expires ? new Date(d.to_expires).toLocaleDateString('th-TH') : 'ไม่มีวันหมด'
    return `${from} → ${to} · ใช้ได้ถึง ${exp}${d.reason ? ` · เหตุผล: ${d.reason}` : ''}`
  }
  if (row.action === 'RESET_REQ') {
    return d.result === 'done' ? 'ทำเครื่องหมายว่าจัดการแล้ว' : 'ทำเครื่องหมายว่าไม่ดำเนินการ'
  }
  return ''
}

/**
 * บันทึกทุกอย่างที่แอดมินทำ
 *
 * ตารางนี้ไม่มี policy update/delete ในฐานข้อมูล = เขียนแล้วลบไม่ได้แม้แต่แอดมินเอง
 * นั่นคือเหตุผลที่มันมีอยู่ — ถ้าแก้ย้อนหลังได้ก็ไม่ต่างจากไม่มี
 */
export default function AuditLog() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    adminListAudit()
      .then((r) => alive && setRows(r))
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [])

  if (error) return <div className="card px-[18px] py-5 text-body text-expense">{error}</div>
  if (rows === null) return <div className="card px-[18px] py-8 text-center text-label text-faint">กำลังโหลด…</div>

  if (rows.length === 0) {
    return (
      <div className="card px-[18px] py-10 text-center">
        <Icon name="history" size={30} className="text-faint mx-auto" />
        <p className="text-body text-muted mt-2">ยังไม่มีบันทึก — แอดมินยังไม่เคยแตะข้อมูลลูกค้า</p>
      </div>
    )
  }

  return (
    <div className="card px-[18px] py-4">
      <div className="text-[13.5px] font-semibold mb-1">บันทึกล่าสุด {rows.length} รายการ</div>
      <p className="text-[11.5px] text-faint mb-2.5">แก้ไขหรือลบย้อนหลังไม่ได้ แม้แต่บัญชีแอดมินเอง</p>
      <div className="divide-y divide-[#F2F0EA]">
        {rows.map((r) => (
          <div key={r.id} className="py-2.5 flex flex-wrap gap-x-3 gap-y-1 items-baseline">
            <span className="text-[11.5px] text-faint tabular-nums w-[130px] flex-none">
              {thaiDateTime(r.created_at)}
            </span>
            <span className="text-[12.5px] font-semibold">{actionLabel(r.action)}</span>
            <span className="text-[12px] text-muted flex-1 min-w-0">{describe(r)}</span>
            <span className="text-[11.5px] text-faint break-all">{r.admin_email}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
