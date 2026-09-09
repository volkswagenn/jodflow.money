import { NavLink, Navigate, useParams } from 'react-router-dom'
import Icon from '../../components/shared/Icon'
import { useAuth } from '../../auth/AuthProvider'
import AdminOverview from './AdminOverview'
import ShopList from './ShopList'
import ResetRequests from './ResetRequests'
import AuditLog from './AuditLog'
import PlatformSettings from './PlatformSettings'

/**
 * หน้าแอดมินระบบ — จัดการ "ลูกค้าทุกราย" ไม่ใช่ข้อมูลในร้านใดร้านหนึ่ง
 *
 * เข้าได้เฉพาะบัญชีที่ profiles.is_platform_admin = true ซึ่งตั้งได้จาก SQL Editor
 * ที่เดียว (ดู supabase/users.sql หมวด 1) คนอื่นเปิด /admin จะถูกส่งกลับหน้าแรก
 * เงียบๆ ไม่ขึ้นว่า "ไม่มีสิทธิ์" — คนนอกไม่ควรรู้ด้วยซ้ำว่าหน้านี้มีอยู่
 *
 * ด่านจริงไม่ได้อยู่ตรงนี้: ทุก RPC ที่หน้าพวกนี้เรียกตรวจ is_platform_admin()
 * ที่ฐานข้อมูลซ้ำอีกรอบ ต่อให้แก้โค้ดฝั่งเบราว์เซอร์ให้เข้ามาได้ ก็ยิงอะไรไม่ออก
 */
const TABS = [
  { key: 'overview', icon: 'monitoring',      label: 'ภาพรวม',        desc: 'ตัวเลขรวมทั้งระบบ' },
  { key: 'shops',    icon: 'groups',          label: 'ลูกค้า',         desc: 'ต่ออายุ ระงับ เปิดดู' },
  { key: 'resets',   icon: 'key',             label: 'คำขอรหัสผ่าน',   desc: 'คิวที่รอเราจัดการ' },
  { key: 'audit',    icon: 'history',         label: 'บันทึกแอดมิน',   desc: 'เราแตะอะไรไปบ้าง' },
  { key: 'settings', icon: 'tune',            label: 'ตั้งค่าระบบ',     desc: 'วันทดลอง เปิด-ปิดสมัคร' },
]

const PANELS = {
  overview: AdminOverview,
  shops: ShopList,
  resets: ResetRequests,
  audit: AuditLog,
  settings: PlatformSettings,
}

export default function AdminPage() {
  const { tab } = useParams()
  const { isPlatformAdmin } = useAuth()

  if (!isPlatformAdmin) return <Navigate to="/" replace />
  if (!TABS.some((t) => t.key === tab)) return <Navigate to="/admin/overview" replace />

  const Panel = PANELS[tab]

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[236px_minmax(0,1fr)] gap-3.5 items-start">
      <nav className="card p-3.5 flex flex-col gap-1 lg:sticky lg:top-[74px]">
        <div className="text-[11px] tracking-[0.1em] uppercase text-faint px-1 pb-1.5">แอดมินระบบ</div>
        {TABS.map((t) => (
          <NavLink
            key={t.key}
            to={`/admin/${t.key}`}
            className={({ isActive }) =>
              `min-h-[44px] px-2.5 py-2 rounded-[10px] flex items-center gap-2.5 transition-colors ${
                isActive ? 'bg-paper' : 'hover:bg-paper'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon name={t.icon} size={19} className={isActive ? 'text-ink' : 'text-faint'} />
                <span className="flex-1 min-w-0">
                  <span className={`block text-[13px] truncate ${isActive ? 'font-semibold text-ink' : 'text-muted'}`}>
                    {t.label}
                  </span>
                  <span className="block text-[11px] text-faint truncate">{t.desc}</span>
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="min-w-0">
        <Panel />
      </div>
    </div>
  )
}
