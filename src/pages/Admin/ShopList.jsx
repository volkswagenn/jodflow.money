import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../../components/shared/Icon'
import TabBar from '../../components/shared/TabBar'
import ConfirmPopup from '../../components/shared/ConfirmPopup'
import { useAuth } from '../../auth/AuthProvider'
import { adminKickUser, adminListShops, adminSetUserActive } from '../../lib/api/platform'
import ShopAccessPopup from './ShopAccessPopup'
import TempPasswordPopup from './TempPasswordPopup'
import { expiryText, statusTone, statusText, thaiDate, thaiDateTime } from './adminFormat'

const FILTERS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'open', label: 'ใช้งานได้' },
  { key: 'trial', label: 'ทดลองใช้' },
  { key: 'expired', label: 'หมดอายุ' },
  { key: 'blocked', label: 'ระงับ/ปิด' },
]

function matches(shop, filter) {
  if (filter === 'all') return true
  if (filter === 'open') return shop.isOpen
  if (filter === 'trial') return shop.status === 'trial' && shop.isOpen
  if (filter === 'expired') return !shop.isOpen && (shop.status === 'trial' || shop.status === 'active')
  return shop.status === 'suspended' || shop.status === 'closed'
}

export default function ShopList() {
  const { enterShopView, shopId } = useAuth()
  const [shops, setShops] = useState(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null)
  const [confirmView, setConfirmView] = useState(null)
  // งานกับ "บัญชี" ของเจ้าของร้าน (ระบบล็อกอินของเราเอง) — ยืนยันก่อนทุกอย่าง เพราะมีผลทันทีกับคนที่ใช้อยู่
  const [userAction, setUserAction] = useState(null) // { kind: 'kick'|'disable'|'enable', shop }
  const [tempFor, setTempFor] = useState(null)       // ร้านที่กำลังตั้งรหัสให้ (ป๊อปอัปของตัวเอง)
  const [actionError, setActionError] = useState('')

  async function runUserAction() {
    const { kind, shop } = userAction
    setActionError('')
    try {
      if (kind === 'kick') await adminKickUser(shop.ownerId)
      else await adminSetUserActive(shop.ownerId, kind === 'enable')
      setUserAction(null)
      reload()
    } catch (e) {
      setActionError(e.message)
      setUserAction(null)
    }
  }

  const USER_ACTION_TEXT = {
    kick: {
      title: 'ออกจากระบบทุกเครื่อง',
      message: 'ทุกเครื่องที่ล็อกอินบัญชีนี้ค้างอยู่จะหลุดทันที ลูกค้าต้องล็อกอินใหม่ (รหัสผ่านไม่เปลี่ยน)\nใช้เมื่อลูกค้าแจ้งว่าเครื่องหายหรือมีคนแอบใช้',
      label: 'ออกจากทุกเครื่อง',
    },
    disable: {
      title: 'ปิดบัญชีผู้ใช้',
      message: 'บัญชีนี้จะล็อกอินไม่ได้ทันที (ข้อมูลร้านยังอยู่ครบ ไม่ถูกลบ) เปิดคืนได้จากปุ่มเดียวกัน\nต่างจาก "ระงับร้าน" ตรงที่ระงับร้านยังล็อกอินได้แต่เห็นหน้าถูกระงับ ส่วนนี้คือเข้าไม่ได้เลย',
      label: 'ปิดบัญชี',
      danger: true,
    },
    enable: {
      title: 'เปิดบัญชีผู้ใช้อีกครั้ง',
      message: 'บัญชีนี้จะกลับมาล็อกอินได้ตามปกติ',
      label: 'เปิดบัญชี',
    },
  }

  const reload = useCallback(() => {
    setError('')
    return adminListShops()
      .then(setShops)
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const counts = useMemo(() => {
    const list = shops ?? []
    return Object.fromEntries(FILTERS.map((f) => [f.key, list.filter((s) => matches(s, f.key)).length]))
  }, [shops])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (shops ?? [])
      .filter((s) => matches(s, filter))
      .filter(
        (s) =>
          !needle ||
          s.name?.toLowerCase().includes(needle) ||
          s.ownerEmail?.toLowerCase().includes(needle) ||
          s.ownerName?.toLowerCase().includes(needle)
      )
  }, [shops, filter, q])

  async function openAsShop(shop) {
    setConfirmView(null)
    await enterShopView(shop.id)
  }

  if (error) {
    return (
      <div className="card px-[18px] py-5 text-body text-expense">
        {error}
        <p className="text-label text-faint mt-2">
          ถ้าขึ้นว่าไม่รู้จักฟังก์ชัน admin_list_shops แปลว่ายังไม่ได้รัน supabase/users.sql
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="card px-[18px] py-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <TabBar
            tabs={FILTERS.map((f) => ({ key: f.key, label: f.label, count: counts[f.key] }))}
            value={filter}
            onChange={setFilter}
          />
          <div className="relative flex-1 min-w-[180px]">
            <Icon name="search" size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              className="input pl-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหาชื่อร้านหรืออีเมล"
            />
          </div>
        </div>
      </div>

      {shops === null && <div className="card px-[18px] py-8 text-center text-label text-faint">กำลังโหลด…</div>}

      {shops !== null && rows.length === 0 && (
        <div className="card px-[18px] py-10 text-center">
          <Icon name="groups" size={30} className="text-faint mx-auto" />
          <p className="text-body text-muted mt-2">ไม่มีลูกค้าในเงื่อนไขนี้</p>
        </div>
      )}

      {rows.map((s) => {
        const isCurrent = s.id === shopId
        return (
          <div key={s.id} className="card px-[18px] py-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-semibold">{s.name}</span>
                  <span className={`px-2 h-[20px] rounded-full text-[11px] font-semibold flex items-center ${statusTone(s)}`}>
                    {statusText(s)}
                  </span>
                  {isCurrent && (
                    <span className="px-2 h-[20px] rounded-full text-[11px] font-semibold flex items-center bg-ink text-lime">
                      กำลังเปิดอยู่
                    </span>
                  )}
                </div>
                <div className="text-[12px] text-muted mt-1 break-all">
                  {s.ownerName ? `${s.ownerName} · ` : ''}
                  {s.ownerEmail ?? '⛔ ไม่มีเจ้าของ — รัน supabase/access.sql'}
                </div>
                {s.suspendReason && (
                  <div className="text-[11.5px] text-expense mt-1">เหตุผลที่ระงับ: {s.suspendReason}</div>
                )}
                {s.ownerId && !s.ownerActive && (
                  <div className="text-[11.5px] text-expense mt-1">บัญชีผู้ใช้ถูกปิด — ล็อกอินไม่ได้</div>
                )}
                {s.ownerId && s.ownerMustChange && (
                  <div className="text-[11.5px] text-pending mt-1">มีรหัสชั่วคราวค้างอยู่ — ลูกค้ายังไม่ได้ตั้งรหัสของตัวเอง</div>
                )}
              </div>

              <div className="text-[11.5px] text-faint leading-relaxed min-w-[170px]">
                <div>{expiryText(s)}</div>
                <div>สมัคร {thaiDate(s.createdAt)} · {s.txCount.toLocaleString('th-TH')} รายการ</div>
                <div>ใช้ล่าสุด {s.lastActive ? thaiDateTime(s.lastActive) : 'ยังไม่เคย'}</div>
              </div>

              <div className="flex gap-1.5 flex-wrap">
                <button className="btn btn-secondary h-9 px-3 text-[12.5px]" onClick={() => setEditing(s)}>
                  <Icon name="manage_accounts" size={17} /> จัดการสิทธิ์
                </button>
                <button
                  className="btn btn-secondary h-9 px-3 text-[12.5px]"
                  onClick={() => setConfirmView(s)}
                  disabled={isCurrent}
                >
                  <Icon name="visibility" size={17} /> เปิดข้อมูล
                </button>
              </div>
            </div>

            {s.ownerId && (
              <div className="mt-3 pt-3 border-t border-[#F2F0EA] flex flex-wrap items-center gap-1.5">
                <span className="text-[11.5px] text-faint mr-1">บัญชีเจ้าของ:</span>
                <button className="btn btn-ghost h-8 px-2.5 text-[12px]" onClick={() => setTempFor(s)}>
                  <Icon name="lock_reset" size={16} /> ตั้งรหัสผ่าน
                </button>
                <button className="btn btn-ghost h-8 px-2.5 text-[12px]" onClick={() => setUserAction({ kind: 'kick', shop: s })}>
                  <Icon name="devices" size={16} /> ออกจากทุกเครื่อง
                </button>
                <button
                  className={`btn btn-ghost h-8 px-2.5 text-[12px] ${s.ownerActive ? 'text-expense' : 'text-income'}`}
                  onClick={() => setUserAction({ kind: s.ownerActive ? 'disable' : 'enable', shop: s })}
                >
                  <Icon name={s.ownerActive ? 'person_off' : 'check_circle'} size={16} /> {s.ownerActive ? 'ปิดบัญชี' : 'เปิดบัญชี'}
                </button>
              </div>
            )}
          </div>
        )
      })}

      {actionError && <div className="card px-[18px] py-3 text-label text-expense">{actionError}</div>}

      {userAction && (
        <ConfirmPopup
          open
          title={USER_ACTION_TEXT[userAction.kind].title}
          message={`${userAction.shop.ownerEmail}\n\n${USER_ACTION_TEXT[userAction.kind].message}`}
          confirmLabel={USER_ACTION_TEXT[userAction.kind].label}
          danger={Boolean(USER_ACTION_TEXT[userAction.kind].danger)}
          onCancel={() => setUserAction(null)}
          onConfirm={runUserAction}
        />
      )}

      {tempFor && (
        <TempPasswordPopup shop={tempFor} onClose={() => setTempFor(null)} onDone={reload} />
      )}

      {editing && (
        <ShopAccessPopup
          shop={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null)
            reload()
          }}
        />
      )}

      {confirmView && (
        <ConfirmPopup
          open
          title="เปิดข้อมูลของลูกค้า"
          message={
            `กำลังจะเข้าไปดูและแก้ข้อมูลของ "${confirmView.name}" (${confirmView.ownerEmail ?? 'ไม่ทราบเจ้าของ'})\n\n` +
            'ทุกอย่างที่ทำต่อจากนี้มีผลกับข้อมูลจริงของลูกค้า และการเข้าครั้งนี้ถูกบันทึกไว้ในบันทึกแอดมิน ' +
            'กลับมาที่ข้อมูลของตัวเองได้จากแถบแดงด้านบนจอ'
          }
          confirmLabel="เปิดข้อมูล"
          onCancel={() => setConfirmView(null)}
          onConfirm={() => openAsShop(confirmView)}
        />
      )}
    </div>
  )
}
