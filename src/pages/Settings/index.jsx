import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useAppStore from '../../store/useAppStore'
import usePendingStore from '../../store/usePendingStore'
import useLogStore from '../../store/useLogStore'
import { BackupFull } from '../Backup/BackupFull'
import LogDownloader from '../Backup/LogDownloader'
import Icon from '../../components/shared/Icon'
import useFormDefaults, { setFormDefaults, formMethodLabel } from '../../hooks/useFormDefaults'
import Popup from '../../components/shared/Popup'
import ResetDataPopup from './ResetDataPopup'
import AccountPanel from '../../auth/AccountPanel'
import { useAuth } from '../../auth/AuthProvider'

/**
 * ตั้งค่า — หน้าเดียวที่เห็นทุกอย่างพร้อมกัน แล้วค่อยกดเข้าไปแก้ทีละเรื่อง
 *
 * ของเดิมเป็นแท็บ 5 อัน ซึ่งต้องกดเข้าไปดูทีละแท็บถึงจะรู้ว่าค่าตั้งไว้เท่าไร
 * แบบการ์ดนี้เห็นค่าปัจจุบันของทุกเรื่องตั้งแต่แรก และเป็นทางเข้าของ
 * "นำเข้าข้อมูล" กับ "สำรองข้อมูล" ที่ถูกย้ายออกจากเมนูหลักมาไว้ที่นี่
 */
function SettingCard({ icon, title, desc, rows = [], action, onClick }) {
  return (
    <section className="card px-[18px] py-4 flex flex-col">
      <div className="flex items-center gap-2.5">
        <Icon name={icon} size={19} className="text-ink" />
        <span className="text-[13.5px] font-semibold">{title}</span>
      </div>
      <p className="text-[11.5px] text-faint leading-relaxed mt-1.5">{desc}</p>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2.5 py-2.5 border-t border-[#F2F0EA] mt-2">
          <span className="flex-1 min-w-0 text-[12.5px]">{r.label}</span>
          <span className={`text-[12.5px] font-semibold ${r.tone === 'ok' ? 'text-income' : r.tone === 'muted' ? 'text-faint' : 'text-ink'}`}>
            {r.value}
          </span>
        </div>
      ))}
      {action && (
        <button
          onClick={onClick}
          className="mt-auto pt-3 text-[12.5px] font-semibold text-income text-left hover:underline"
        >
          {action}
        </button>
      )}
    </section>
  )
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const { notifyDaysBefore, setNotifyDaysBefore, version } = useAppStore()
  const { profile, user, role, shop, shopDaysLeft, isPlatformAdmin } = useAuth()
  const taxWaiting = usePendingStore((s) => s.taxInvoices.filter((t) => t.status === 'waiting').length)
  const logCount = useLogStore((s) => s.total)

  const [panel, setPanel] = useState(null) // account | notify | backup | logs | form
  const formDefaults = useFormDefaults()
  const [notifyDays, setNotifyDays] = useState(String(notifyDaysBefore ?? 3))
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)

  /**
   * ค่านี้เก็บที่ shop_settings และแก้ได้เฉพาะเจ้าของร้าน (RLS บังคับ)
   * ต้องรอผลจริงก่อนขึ้นว่าบันทึกแล้ว — ของเดิมยิงทิ้งไว้เฉยๆ ทำให้ editor
   * ที่ไม่มีสิทธิ์เห็นข้อความ "บันทึกแล้ว" ทั้งที่เซิร์ฟเวอร์ปฏิเสธไปเรียบร้อย
   */
  const saveNotifyDays = async () => {
    if (saving) return
    const value = Math.max(0, Number(notifyDays) || 0)
    setSaving(true)
    setSaveError('')
    try {
      await setNotifyDaysBefore(value)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const ROLE_LABEL = { owner: 'เจ้าของร้าน', editor: 'แก้ไขได้', viewer: 'ดูอย่างเดียว' }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 wide:grid-cols-4 gap-3.5 content-start">
      <SettingCard
        icon="notifications"
        title="การแจ้งเตือน"
        desc="เตือนล่วงหน้าก่อนถึงวันครบกำหนดของรายการค้างจ่ายและรอรับเงิน"
        rows={[
          { label: 'เตือนล่วงหน้า', value: `${notifyDaysBefore} วัน` },
          { label: 'ใบกำกับภาษีที่ยังรออยู่', value: `${taxWaiting} รายการ`, tone: taxWaiting ? 'default' : 'muted' },
        ]}
        action="แก้ไขการแจ้งเตือน"
        onClick={() => setPanel('notify')}
      />

      <SettingCard
        icon="account_circle"
        title="บัญชีผู้ใช้และสมาชิก"
        desc="ใครเข้าถึงร้านนี้ได้ และแก้ไขอะไรได้บ้าง"
        rows={[
          { label: `${profile?.display_name ?? user?.email ?? 'คุณ'} (คุณ)`, value: ROLE_LABEL[role] ?? '—' },
          { label: 'ร้าน', value: shop?.name ?? '—' },
        ]}
        action="จัดการบัญชีและรหัสผ่าน"
        onClick={() => setPanel('account')}
      />

      {/* สถานะการใช้งาน — ต้องหาเจอโดยไม่ต้องรอให้แถบเตือนขึ้น ลูกค้าที่อยากต่ออายุ
          ล่วงหน้าจะได้รู้ว่าตัวเองเหลือกี่วันโดยไม่ต้องทักมาถาม */}
      <SettingCard
        icon="workspace_premium"
        title="สถานะการใช้งาน"
        desc={
          shop?.status === 'trial'
            ? 'ช่วงทดลองใช้ฟรี — ข้อมูลที่บันทึกไว้จะอยู่ต่อแม้หมดช่วงทดลอง'
            : 'สิทธิ์การใช้งานของสมุดบัญชีนี้'
        }
        rows={[
          {
            label: 'สถานะ',
            value: shop?.status === 'trial' ? 'ทดลองใช้ฟรี' : shop?.status === 'active' ? 'ใช้งานอยู่' : (shop?.status ?? '—'),
            tone: shop?.status === 'active' ? 'ok' : 'default',
          },
          {
            label: 'ใช้ได้ถึง',
            value: shop?.expires_at
              ? new Date(shop.expires_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
              : 'ไม่มีวันหมดอายุ',
            tone: shop?.expires_at ? 'default' : 'ok',
          },
          ...(shopDaysLeft === null
            ? []
            : [{
                label: 'เหลืออีก',
                value: shopDaysLeft <= 0 ? 'วันสุดท้าย' : `${shopDaysLeft} วัน`,
                tone: shopDaysLeft <= 7 ? 'default' : 'muted',
              }]),
        ]}
      />

      {isPlatformAdmin && (
        <SettingCard
          icon="shield_person"
          title="แอดมินระบบ"
          desc="จัดการลูกค้าทุกราย ต่ออายุ ระงับ และดูบันทึกการเข้าถึงข้อมูล"
          rows={[{ label: 'เห็นเฉพาะบัญชีแอดมิน', value: 'ตั้งได้ที่ฐานข้อมูลเท่านั้น', tone: 'muted' }]}
          action="เปิดหน้าแอดมิน"
          onClick={() => navigate('/admin')}
        />
      )}

      <SettingCard
        icon="backup"
        title="ส่งออกและสำรองข้อมูล"
        desc="ดาวน์โหลดข้อมูลทั้งหมดของร้านเป็นไฟล์ JSON หรือดาวน์โหลด/ล้างประวัติการใช้งาน"
        rows={[
          { label: 'ข้อมูลจริงอยู่บนเซิร์ฟเวอร์', value: 'สำรองอัตโนมัติ', tone: 'ok' },
          { label: 'ประวัติที่โหลดมาแล้ว', value: `${logCount.toLocaleString()} รายการ`, tone: 'muted' },
        ]}
        action="เปิดหน้าสำรองข้อมูล"
        onClick={() => setPanel('backup')}
      />

      <SettingCard
        icon="upload_file"
        title="นำเข้าข้อมูล"
        desc="กรอกย้อนหลังเป็นตารางรายวัน หรือแนบไฟล์ Excel/CSV ที่ส่งออกไว้"
        rows={[{ label: 'รูปแบบที่รองรับ', value: 'รายวัน · แยกประเภท · สรุป', tone: 'muted' }]}
        action="ไปหน้านำเข้าข้อมูล"
        onClick={() => navigate('/import')}
      />

      <SettingCard
        icon="tune"
        title="ค่าเริ่มต้นของฟอร์ม"
        desc="ตั้งค่าที่ทำให้บันทึกรายการเร็วขึ้น — เก็บไว้ในเครื่องนี้ แต่ละคนตั้งของตัวเองได้"
        rows={[
          { label: 'ช่องทางจ่ายเริ่มต้น', value: formMethodLabel(formDefaults.method) },
          {
            label: 'บันทึกแล้วเปิดฟอร์มใหม่',
            value: formDefaults.reopenAfterSave ? 'เปิด' : 'ปิด',
            tone: formDefaults.reopenAfterSave ? 'ok' : 'muted',
          },
        ]}
        action="แก้ค่าเริ่มต้น"
        onClick={() => setPanel('form')}
      />

      {/* รีเซ็ตข้อมูล — แยกการ์ดของตัวเอง ไม่ซ่อนอยู่ในป๊อปอัปสำรองข้อมูลเหมือนเดิม
          เพราะเป็นงานที่ตั้งใจมาทำ ไม่ใช่ของแถมของการดาวน์โหลดไฟล์ */}
      <SettingCard
        icon="delete_sweep"
        title="รีเซ็ตข้อมูล"
        desc="ล้างข้อมูลเพื่อเริ่มใหม่ — เลือกได้ว่าจะล้างเฉพาะรายการเดินบัญชี หรือล้างทั้งหมด"
        rows={[
          { label: 'ล้างแล้วกู้คืนไม่ได้', value: 'โหลดไฟล์สำรองก่อน', tone: 'muted' },
          { label: 'สิทธิ์ที่ทำได้', value: role === 'owner' ? 'คุณทำได้' : 'เจ้าของร้านเท่านั้น', tone: role === 'owner' ? 'default' : 'muted' },
        ]}
        action="เปิดหน้ารีเซ็ตข้อมูล"
        onClick={() => setPanel('reset')}
      />

      <SettingCard
        icon="info"
        title="เกี่ยวกับแอป"
        desc="เวอร์ชันและสถานะการเชื่อมต่อ"
        rows={[
          { label: 'เวอร์ชัน', value: `v${version}` },
          { label: 'สถานะเซิร์ฟเวอร์', value: 'เชื่อมต่ออยู่', tone: 'ok' },
        ]}
      />


      {panel === 'account' && (
        <Popup title="บัญชีผู้ใช้" sub={user?.email} icon="account_circle" width={520} onClose={() => setPanel(null)}>
          <AccountPanel />
        </Popup>
      )}

      {panel === 'notify' && (
        <Popup
          title="การแจ้งเตือน"
          sub="ใช้กับรายการค้างชำระและรอรับเงิน"
          icon="notifications"
          width={420}
          onClose={() => setPanel(null)}
          onConfirm={saveNotifyDays}
          busy={saving}
          confirmLabel="บันทึกการตั้งค่า"
          error={saveError}
        >
          <label className="label">เตือนล่วงหน้ากี่วันก่อนครบกำหนด</label>
          <input className="input" type="number" min="0" value={notifyDays} onChange={(e) => setNotifyDays(e.target.value)} />
          {saved && (
            <p className="text-[12.5px] text-income bg-income-soft border border-[#BFE0D2] rounded-ctl px-3.5 py-2">
              บันทึกการตั้งค่าแล้ว
            </p>
          )}
        </Popup>
      )}

      {/* สำรองข้อมูลกับประวัติการใช้งานอยู่ป๊อปอัปเดียวกัน เพราะเป็นเรื่องเดียวกันคือ
          "เอาข้อมูลออกจากระบบ" และการ์ดตั้งค่ามีได้ 6 ใบตามแบบ */}
      {panel === 'backup' && (
        <Popup title="สำรองข้อมูล" sub="ดาวน์โหลดข้อมูลทั้งหมดของร้าน" icon="backup" width={520} onClose={() => setPanel(null)}>
          <BackupFull />
          <div className="border-t border-[#F2F0EA] pt-3 mt-1">
            <div className="text-[12.5px] font-semibold mb-2">ประวัติการใช้งาน</div>
            <LogDownloader />
          </div>
        </Popup>
      )}

      {panel === 'reset' && (
        <ResetDataPopup isOwner={role === 'owner'} onClose={() => setPanel(null)} />
      )}

      {panel === 'form' && (
        <Popup
          title="ค่าเริ่มต้นของฟอร์ม"
          sub="ใช้กับเครื่องนี้เท่านั้น"
          icon="tune"
          width={460}
          onClose={() => setPanel(null)}
        >
          <div>
            <label className="block text-[12px] text-muted mb-1.5">ช่องทางจ่ายเริ่มต้น</label>
            <div className="grid grid-cols-2 gap-2">
              {['cash', 'transfer', 'card', 'pending'].map((m) => {
                const on = formDefaults.method === m
                return (
                  <button
                    key={m}
                    onClick={() => setFormDefaults({ method: m })}
                    className={`h-10 rounded-[11px] border text-[13px] transition ${
                      on ? 'border-ink shadow-[0_0_0_1px_#16181D] bg-[#F2FAD9] font-semibold' : 'border-hairline bg-white hover:bg-paper'
                    }`}
                  >
                    {formMethodLabel(m)}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-faint leading-relaxed mt-1.5">
              เปิดฟอร์มบันทึกรายจ่ายครั้งถัดไปจะเลือกช่องทางนี้ให้เลย เปลี่ยนเป็นอย่างอื่นได้เสมอ
            </p>
          </div>

          <button
            onClick={() => setFormDefaults({ reopenAfterSave: !formDefaults.reopenAfterSave })}
            className="flex items-center gap-2.5 text-left"
          >
            <span
              className={`w-[18px] h-[18px] flex-none rounded-[5px] border flex items-center justify-center ${
                formDefaults.reopenAfterSave ? 'bg-lime border-lime' : 'bg-white border-hairline'
              }`}
            >
              {formDefaults.reopenAfterSave && <Icon name="check" size={14} className="text-ink" />}
            </span>
            <span className="text-[12.5px]">
              บันทึกแล้วเปิดฟอร์มใหม่ทันที
              <span className="block text-[11px] text-faint">
                เหมาะกับตอนกรอกหลายรายการติดกัน ปิดไว้ถ้าอยากเห็นสิ่งที่เพิ่งบันทึกค้างอยู่
              </span>
            </span>
          </button>
        </Popup>
      )}
    </div>
  )
}
