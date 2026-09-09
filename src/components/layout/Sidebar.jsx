import { NavLink, useNavigate } from 'react-router-dom'
import usePendingStore from '../../store/usePendingStore'
import useCreditCardStore from '../../store/useCreditCardStore'
import { useAuth } from '../../auth/AuthProvider'
import Icon from '../shared/Icon'
import { ADMIN_GROUP, NAV_GROUPS } from './navConfig'

const ROLE_LABEL = { owner: 'เจ้าของร้าน', editor: 'ผู้บันทึก', viewer: 'ผู้ดู' }

function NavBadge({ count, tone }) {
  if (!count) return null
  const cls = tone === 'amber' ? 'bg-[#E0A32B] text-ink' : 'bg-expense text-white'
  return (
    <span className={`ml-auto min-w-5 h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center tabular-nums ${cls}`}>
      {count > 99 ? '99+' : count}
    </span>
  )
}

function MenuItem({ item, badgeCounts, onNavigate }) {
  const total = (item.badges ?? []).reduce((a, k) => a + (badgeCounts[k] ?? 0), 0)

  return (
    <NavLink
      to={item.to}
      title={item.label}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex items-center gap-[11px] h-[38px] px-[11px] rounded-[11px] transition-colors ${
          isActive ? 'bg-lime/[0.14]' : 'hover:bg-white/[0.06]'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            name={item.icon}
            size={19}
            fill={isActive}
            className={`flex-none ${isActive ? 'text-lime' : 'text-ink-soft'}`}
          />
          <span className={`truncate text-[13px] ${isActive ? 'text-white font-semibold' : 'text-[#A9AFB7]'}`}>
            {item.label}
          </span>
          <NavBadge count={total} tone={item.badgeTone} />
        </>
      )}
    </NavLink>
  )
}

/**
 * เมนูข้าง — จอ lg ขึ้นไปติดอยู่ตลอด จอเล็กเป็นลิ้นชักที่เปิดจากปุ่มเมนู
 * (บนมือถือมีแถบล่างเป็นทางลัดหลักอยู่แล้ว ดู BottomTabs)
 */
export default function Sidebar({ open, onClose }) {
  const navigate = useNavigate()
  const { profile, user, shop, role, isPlatformAdmin } = useAuth()
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '3.0.0' // eslint-disable-line no-undef

  const pendingCount = usePendingStore((s) => s.pendingPayments.filter((p) => p.status === 'pending').length)
  const incomeCount = usePendingStore((s) => s.pendingIncomes.filter((p) => p.status === 'pending').length)
  const cardBillCount = useCreditCardStore((s) => s.getUnpaidStatements().length)

  const badgeCounts = { pending: pendingCount, income: incomeCount, cardBill: cardBillCount }
  const displayName = profile?.display_name ?? user?.email ?? 'ผู้ใช้'

  return (
    <>
      {open && <div className="fixed inset-0 z-20 bg-ink/40 lg:hidden" onClick={onClose} />}

      <aside
        className={`fixed top-0 left-0 bottom-0 z-30 w-[256px] bg-ink flex flex-col py-[18px] px-3 overflow-hidden
          transition-transform duration-200 lg:translate-x-0
          ${open ? 'translate-x-0 shadow-pop' : '-translate-x-full'}`}
      >
        {/* โลโก้ + ชื่อร้าน */}
        <div className="flex items-center gap-2.5 px-2 pb-5">
          <div className="w-[34px] h-[34px] flex-none rounded-[11px] bg-lime flex items-center justify-center text-[17px] font-bold text-ink">
            J
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-white leading-tight">JodFlow</div>
            <div className="text-[11px] text-ink-soft truncate">{shop?.name ?? 'บันทึกรายรับ-รายจ่าย'}</div>
          </div>
        </div>

        {/* ปุ่มหลักของทั้งแอป — อยู่เหนือเมนูเพราะเป็นสิ่งที่กดบ่อยที่สุด
            ป้าย N บอกปุ่มลัด กด N ที่ไหนก็ได้เพื่อเปิดฟอร์มบันทึก (ดู useHotkey ด้านล่าง) */}
        <button
          onClick={() => { navigate('/transactions'); onClose?.() }}
          className="flex items-center gap-2 h-[42px] px-3.5 rounded-ctl bg-lime text-ink text-[13.5px] font-semibold mb-[18px] hover:bg-lime-dark"
        >
          <Icon name="add" size={19} />
          บันทึกรายการ
          <kbd className="ml-auto text-[10.5px] font-semibold rounded-[5px] px-1.5 py-0.5 bg-ink/[0.16] text-ink">
            N
          </kbd>
        </button>

        <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          {(isPlatformAdmin ? [...NAV_GROUPS, ADMIN_GROUP] : NAV_GROUPS).map((group) => (
            <div key={group.title} className="mb-3.5">
              <div className="text-[10.5px] tracking-[0.12em] uppercase text-[#5A5F67] px-[11px] pb-1.5">
                {group.title}
              </div>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <MenuItem key={item.to} item={item} badgeCounts={badgeCounts} onNavigate={onClose} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-auto bg-[#1D2027] rounded-ctl px-[13px] py-3">
          <div className="text-[11.5px] text-[#A9AFB7] truncate">
            {displayName} · {ROLE_LABEL[role] ?? 'สมาชิก'}
          </div>
          <div className="text-[10.5px] text-[#5A5F67] mt-1.5">JodFlow v{version}</div>
        </div>
      </aside>
    </>
  )
}
