import Popup from '../../components/shared/Popup'
import { useState } from 'react'
import AmountInput from '../../components/shared/AmountInput'
import useWalletStore from '../../store/useWalletStore'
import useLogStore from '../../store/useLogStore'
import { buildLogEntry } from '../../lib/logBuilder'
import { formatAccount } from '../../components/shared/TransferAccountPicker'
import ConfirmPopup from '../../components/shared/ConfirmPopup'
import AmountDisplay from '../../components/shared/AmountDisplay'
import BankSelect from '../../components/shared/BankSelect'
import { BANKS } from '../../lib/banks'
import { useRegisterManageAdd } from './manageHeader'
import { IconPickerButton } from '../../components/shared/IconPicker'
import AppIcon from '../../components/shared/AppIcon'
import { DEFAULT_ICONS } from '../../lib/defaultIcons'
import RowMenu from '../../components/shared/RowMenu'

const BANK_NAMES = BANKS.map((b) => b.name)

/** ประเภทบัญชี — ตรงกับ constraint ใน supabase/account.sql */
export const ACCOUNT_KINDS = [
  { value: 'savings', label: 'ออมทรัพย์' },
  { value: 'current', label: 'กระแสรายวัน' },
  { value: 'ewallet', label: 'e-Wallet' },
  { value: 'other',   label: 'อื่นๆ' },
]
export const kindLabel = (k) => ACCOUNT_KINDS.find((x) => x.value === k)?.label ?? ''

/**
 * ฟอร์มเพิ่ม/แก้ไขบัญชี — ย้ายมาจากหน้ากระเป๋าเงิน
 * เพิ่มประเภทบัญชีกับเลขบัญชีตามแบบ Wallet Story ไว้แยกบัญชีธนาคารเดียวกันหลายบัญชี
 */
function AccountFormPopup({ account, onSave, onClose, busy }) {
  const isEdit = !!account
  const [bankName, setBankName] = useState(account?.bankName ?? '')
  const [customBank, setCustomBank] = useState(
    account?.bankName && !BANK_NAMES.includes(account.bankName) ? account.bankName : ''
  )
  const [useCustom, setUseCustom] = useState(!!account?.bankName && !BANK_NAMES.includes(account.bankName))
  const [name, setName] = useState(account?.name ?? '')
  const [kind, setKind] = useState(account?.kind ?? 'savings')
  const [accountNo, setAccountNo] = useState(account?.accountNo ?? '')
  const [initialBalance, setInitialBalance] = useState(account ? String(account.balance) : '')
  const [icon, setIcon] = useState(account?.icon ?? null)
  const [error, setError] = useState('')

  const submit = () => {
    if (busy) return
    const bank = useCustom ? customBank.trim() : bankName
    if (!bank) return setError('เลือกหรือพิมพ์ชื่อธนาคาร')
    if (!name.trim()) return setError('กรอกชื่อบัญชี')
    onSave({
      bankName: bank,
      name: name.trim(),
      kind,
      accountNo: accountNo.trim(),
      initialBalance: Number(initialBalance) || 0,
      icon: icon ?? null,
    })
  }

  return (
    <Popup
      title={isEdit ? 'แก้ไขบัญชี' : 'เพิ่มบัญชีธนาคาร'}
      icon="account_balance"
      width={460}
      onClose={onClose}
      onConfirm={submit}
      busy={busy}
      confirmLabel={isEdit ? 'บันทึก' : 'เพิ่มบัญชี'}
    >
        <div>
          <label className="label">ธนาคาร</label>
          {useCustom ? (
            <div className="flex gap-2">
              <input
                className="input flex-1"
                value={customBank}
                onChange={(e) => { setCustomBank(e.target.value); setError('') }}
                placeholder="พิมพ์ชื่อธนาคาร..."
                autoFocus
              />
              <button className="btn btn-secondary text-xs px-2" onClick={() => setUseCustom(false)}>เลือกจากรายการ</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <BankSelect value={bankName} onChange={(v) => { setBankName(v); setError('') }} />
              </div>
              <button className="btn btn-secondary text-xs px-2 shrink-0" onClick={() => setUseCustom(true)}>อื่นๆ</button>
            </div>
          )}
        </div>

        <div>
          <label className="label">ชื่อบัญชี / ชื่อเรียก</label>
          {/* ไอคอนอยู่ติดกับชื่อ เพราะสองอย่างนี้คือสิ่งที่ใช้แยกบัญชีออกจากกันในทุกหน้า
              ไม่เลือกก็ได้ — จะใช้โลโก้ธนาคารตามชื่อธนาคารที่เลือกไว้แทน */}
          <div className="flex items-center gap-2">
            <IconPickerButton
              value={icon}
              onChange={setIcon}
              tone="#3A55C4"
              emptyIcon={DEFAULT_ICONS.account}
              title="เลือกไอคอนของบัญชีนี้"
            />
          <input
            className="input"
            value={name}
            onChange={(e) => { setName(e.target.value); setError('') }}
            placeholder="เช่น บัญชีร้าน, บัญชีสำรอง"
          />
          </div>
          <p className="text-xs text-gray-400 mt-1">ไม่เลือกไอคอนก็ได้ — จะใช้โลโก้ธนาคารให้เอง</p>
        </div>

        <div>
          <label className="label">ประเภทบัญชี</label>
          <div className="grid grid-cols-4 gap-1.5">
            {ACCOUNT_KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                className={`btn text-xs py-1.5 px-1 ${kind === k.value ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setKind(k.value)}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">เลขบัญชี (ไม่บังคับ)</label>
          <input
            className="input"
            value={accountNo}
            onChange={(e) => setAccountNo(e.target.value)}
            placeholder="ใส่แค่ 4 ตัวท้ายก็พอ เช่น x1234"
          />
          <p className="text-xs text-gray-400 mt-1">ไว้แยกบัญชีธนาคารเดียวกันหลายบัญชี ไม่ต้องใส่เลขเต็ม</p>
        </div>

        <div>
          <label className="label">{isEdit ? 'ยอดเงินคงเหลือ' : 'ยอดเงินเริ่มต้น'} (บาท)</label>
          <AmountInput
            className="input"
            value={initialBalance}
            onChange={(e) => { setInitialBalance(e.target.value); setError('') }}
            placeholder="0.00"
          />
          {isEdit && (
            <p className="text-xs text-amber-600 mt-1">
              ⚠️ การแก้ยอดตรงนี้เป็นการปรับยอดคงเหลือโดยตรง ไม่สร้างรายการรับ-จ่าย
            </p>
          )}
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">⚠️ {error}</p>}
    </Popup>
  )
}

export default function AccountManage() {
  const accounts = useWalletStore((s) => s.transferAccounts)
  const { createTransferAccount, updateTransferAccount, deleteTransferAccount, adjustTransferAccount } = useWalletStore()
  const { addLog } = useLogStore()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useRegisterManageAdd(() => { setEditing(null); setFormOpen(true) })

  const run = async (fn) => {
    if (busy) return
    setBusy(true); setError('')
    try { await fn() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  // ทุก action รอเซิร์ฟเวอร์ตอบก่อนปิดฟอร์ม ยอดขยับผ่าน RPC แบบ balance + delta เท่านั้น
  const handleSave = (data) => run(async () => {
    if (editing) {
      const before = { ...editing }
      const newBalance = Number(data.initialBalance) || 0
      const delta = newBalance - (Number(before.balance) || 0)
      await updateTransferAccount(editing.id, {
        bankName: data.bankName, name: data.name, kind: data.kind, accountNo: data.accountNo || null,
        icon: data.icon ?? null,
      })
      if (delta !== 0) await adjustTransferAccount(editing.id, delta)
      addLog(buildLogEntry({
        activityType: 'TRANSFER_ACCOUNT_UPDATE',
        description: `แก้ไขบัญชีเงินโอน "${formatAccount(before)}" → "${data.bankName} — ${data.name}"`
          + (delta !== 0
            ? ` (ปรับยอด ${Number(before.balance).toLocaleString()} → ${newBalance.toLocaleString()} บาท)` : ''),
        oldValue: before,
        newValue: { ...data, balance: newBalance },
        walletEffect: delta !== 0 ? { target: 'transfer', delta, transferAccountId: editing.id } : null,
      }))
      setEditing(null)
    } else {
      const account = await createTransferAccount(data)
      addLog(buildLogEntry({
        activityType: 'TRANSFER_ACCOUNT_CREATE',
        description: `สร้างบัญชีเงินโอน "${formatAccount(account)}" ยอดเริ่มต้น ${Number(account.balance).toLocaleString()} บาท`,
        newValue: account,
        // ยอดเริ่มต้นคือเงินก้อนแรกของบัญชี ต้องนับเป็นความเคลื่อนไหวด้วย
        // ไม่งั้นใบแจ้งยอดจะมียอดคงเหลือโผล่มาโดยไม่มีที่มา
        walletEffect: Number(account.balance)
          ? { target: 'transfer', delta: Number(account.balance), transferAccountId: account.id }
          : null,
      }))
      setFormOpen(false)
    }
  })

  const handleDelete = () => run(async () => {
    const target = deleting
    await deleteTransferAccount(target.id)
    addLog(buildLogEntry({
      activityType: 'TRANSFER_ACCOUNT_DELETE',
      description: `ลบบัญชีเงินโอน "${formatAccount(target)}"`,
      oldValue: target,
    }))
    setDeleting(null)
  })

  return (
    // ชื่อหัวข้อกับปุ่มเพิ่มอยู่บนหัวการ์ดของหน้าจัดการข้อมูล (ดู manageHeader.js)
    <div className="space-y-3">
      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">⚠️ {error}</p>}

      {accounts.length === 0 ? (
        <div className="text-center py-10 text-gray-400">
          <p className="text-4xl mb-3">🏦</p>
          <p className="text-sm">ยังไม่มีบัญชีธนาคาร</p>
          <p className="text-xs mt-1">กด "เพิ่มบัญชี" เพื่อเพิ่มบัญชีแรก</p>
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map((a) => (
            // จอแคบวางยอดกับปุ่มลงมาแถวล่าง ไม่งั้นชื่อบัญชีถูกบีบเหลือ "บัญ…" อ่านไม่ออก
            <div key={a.id} className="rounded-xl border border-gray-200 p-3.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {/* ไอคอนที่ผู้ใช้เลือก (สีตามกลุ่ม/แบรนด์ของมันเอง) — ไม่ได้เลือกใช้รูปธนาคารกลางๆ
                    ไม่เดาโลโก้จากชื่อธนาคารให้แล้ว ผู้ใช้อยากได้โลโก้ธนาคารก็เลือกจากกลุ่ม "ธนาคารไทย" เอง */}
                <span className="w-10 h-10 flex-none rounded-lg bg-paper flex items-center justify-center">
                  <AppIcon value={a.icon} size={22} fallback={DEFAULT_ICONS.account} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{a.name}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {a.bankName}
                    {a.kind && ` · ${kindLabel(a.kind)}`}
                    {a.accountNo && ` · ${a.accountNo}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 justify-between sm:justify-end">
                <AmountDisplay amount={a.balance} size="md" />
                <div className="flex gap-1 shrink-0">
                  <RowMenu
                    title={a.name}
                    sub={formatAccount(a)}
                    icon="account_balance"
                    items={[
                      { icon: 'edit_note', label: 'แก้ไขบัญชี', desc: 'ชื่อ ธนาคาร ยอด', onClick: () => setEditing(a) },
                      { icon: 'close', label: 'ลบบัญชีนี้', desc: 'ประวัติยังอยู่', danger: true, onClick: () => setDeleting(a) },
                    ]}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(formOpen || editing) && (
        <AccountFormPopup
          account={editing}
          onSave={handleSave}
          onClose={() => { setFormOpen(false); setEditing(null) }}
          busy={busy}
        />
      )}

      <ConfirmPopup
        open={!!deleting}
        title="ลบบัญชีธนาคาร"
        message={deleting
          ? `ลบบัญชี "${formatAccount(deleting)}"?\n\n`
            + (deleting.balance !== 0
              ? `• บัญชีนี้มียอดคงเหลือ ${deleting.balance.toLocaleString()} บาท — ยอดนี้จะหายไปจากยอดรวมเงินโอน\n`
              : '• บัญชีนี้ยอดเป็น 0\n')
            + '• รายการเก่าที่ผูกกับบัญชีนี้ยังอยู่ครบ แต่จะแสดงว่า "ไม่ระบุบัญชี"'
          : ''}
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
        confirmLabel="ลบบัญชี"
        danger
      />
    </div>
  )
}
