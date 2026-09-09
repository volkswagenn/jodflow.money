import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/shared/Icon'
import { adminOverview } from '../../lib/api/platform'

function Tile({ icon, label, value, sub, tone = 'ink' }) {
  const toneClass =
    tone === 'warn' ? 'text-pending' : tone === 'bad' ? 'text-expense' : tone === 'good' ? 'text-income' : 'text-ink'
  return (
    <div className="card px-[18px] py-4">
      <div className="flex items-center gap-2 text-faint">
        <Icon name={icon} size={17} />
        <span className="text-[11.5px]">{label}</span>
      </div>
      <div className={`text-[26px] font-semibold tabular-nums mt-1.5 ${toneClass}`}>{value}</div>
      {sub && <div className="text-[11.5px] text-faint mt-0.5">{sub}</div>}
    </div>
  )
}

export default function AdminOverview() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    adminOverview()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [])

  if (error) {
    return (
      <div className="card px-[18px] py-5 text-body text-expense">
        {error}
        <p className="text-label text-faint mt-2">
          ถ้าขึ้นว่าไม่รู้จักฟังก์ชัน admin_overview แปลว่ายังไม่ได้รัน supabase/users.sql
        </p>
      </div>
    )
  }

  if (!data) {
    return <div className="card px-[18px] py-8 text-center text-label text-faint">กำลังโหลด…</div>
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Tile icon="groups" label="ลูกค้าทั้งหมด" value={data.totalShops} sub={`ใช้งานได้อยู่ ${data.openShops}`} />
        <Tile icon="schedule" label="กำลังทดลองใช้" value={data.trialShops} tone="warn" sub="ยังไม่เคยต่ออายุ" />
        <Tile icon="event_busy" label="หมดอายุแล้ว" value={data.expiredShops} tone={data.expiredShops ? 'bad' : 'ink'} sub="เข้าใช้ไม่ได้จนกว่าจะต่อ" />
        <Tile icon="trending_up" label="สมัครใหม่ 7 วัน" value={data.new7d} tone="good" sub={`มีความเคลื่อนไหว ${data.active7d} ราย`} />
      </div>

      {data.pendingResets > 0 && (
        <Link
          to="/admin/resets"
          className="card px-[18px] py-4 flex items-center gap-3 hover:bg-[#FAF9F6] transition-colors"
        >
          <div className="w-9 h-9 rounded-panel bg-pending-soft text-pending flex items-center justify-center flex-none">
            <Icon name="key" size={19} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold">มีคำขอรีเซ็ตรหัสผ่านรออยู่ {data.pendingResets} รายการ</div>
            <div className="text-[11.5px] text-faint">กดเพื่อดูคิวและตั้งรหัสใหม่ให้ลูกค้า</div>
          </div>
          <Icon name="chevron_right" size={19} className="text-faint" />
        </Link>
      )}

      <div className="card px-[18px] py-4">
        <div className="text-[13.5px] font-semibold mb-2">ข้อควรรู้</div>
        <ul className="text-[12px] text-muted leading-relaxed space-y-1.5 list-disc pl-4">
          <li>ลูกค้าที่หมดอายุ <b className="text-ink">ข้อมูลไม่ถูกลบ</b> แค่เข้าใช้ไม่ได้ ต่ออายุเมื่อไหร่ก็กลับมาครบ</li>
          <li>ลูกค้าลืมรหัส: ยืนยันวันเกิด + เบอร์แล้วตั้งใหม่เองได้ · ไม่ผ่านจะเข้าคิว "คำขอรหัสผ่าน" ให้คุณออกรหัสชั่วคราวจากแท็บลูกค้า</li>
          <li>ทุกครั้งที่เปิดดูข้อมูลลูกค้า ระบบบันทึกไว้ในแท็บ "บันทึกแอดมิน" โดยข้ามไม่ได้</li>
        </ul>
      </div>
    </div>
  )
}
