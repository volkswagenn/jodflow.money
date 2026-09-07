import { useState } from 'react'
import { Link } from 'react-router-dom'
import useWalletStore from '../../store/useWalletStore'
import AmountDisplay from '../../components/shared/AmountDisplay'
import AppIcon from '../../components/shared/AppIcon'
import { DEFAULT_ICONS } from '../../lib/defaultIcons'
import Icon from '../../components/shared/Icon'
import WalletItemPopup from './WalletItemPopup'
import { kindLabel } from '../Manage/AccountManage'

/**
 * บัญชีเงินโอนบนหน้ากระเป๋าเงิน — มีไว้ "ดูยอดและย้ายเงิน" เท่านั้น
 * การเพิ่ม แก้ไข ลบ ย้ายไปอยู่ที่ จัดการข้อมูล → บัญชีธนาคาร (AccountManage)
 * เพื่อให้หน้านี้เหลือแต่งานประจำวัน ไม่มีปุ่มแก้ไขปนกับตัวเลข
 */
export default function TransferAccountList() {
  const accounts = useWalletStore((s) => s.transferAccounts)
  const [menuAccount, setMenuAccount] = useState(null)

  return (
    <div className="space-y-3">
      {/* ไม่มีปุ่ม "ย้ายเงิน" กับ "จัดการบัญชี" ซ้ำตรงนี้แล้ว — ย้ายเงินอยู่ในเมนู ⋮ ท้ายบัญชี
          (โอนไปบัญชีอื่น) ซึ่งรู้อยู่แล้วว่าย้ายจากบัญชีไหน ส่วนจัดการบัญชีอยู่ที่หัวการ์ด
          หัวข้อนี้จึงเหลือแต่ตัวเลขให้อ่าน ไม่มีปุ่มปนกับยอดเงิน */}
      <p className="text-xs text-gray-500">
        ยอดรวมของทุกบัญชีคือยอด "กระเป๋าเงินโอน" ที่แสดงด้านบนและบนหน้า Dashboard
      </p>

      {accounts.length === 0 ? (
        <div className="text-center py-10 text-gray-400">
          <p className="text-4xl mb-3">🏦</p>
          <p className="text-sm">ยังไม่มีบัญชีเงินโอน</p>
          <p className="text-xs mt-1">
            เพิ่มบัญชีได้ที่{' '}
            <Link to="/manage/accounts" className="text-blue-600 hover:underline">จัดการข้อมูล → บัญชีธนาคาร</Link>
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map((a) => (
            <div
              key={a.id}
              className={`rounded-xl border p-3.5 flex items-center gap-3 ${
                a.balance < 0 ? 'border-red-200 bg-red-50' : 'border-blue-100 bg-blue-50/50'
              }`}
            >
              <span className="w-10 h-10 flex-none rounded-lg bg-white border border-hairline flex items-center justify-center">
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
              <div className="text-right shrink-0">
                <AmountDisplay amount={a.balance} size="md" />
              </div>
              <button
                onClick={() => setMenuAccount(a)}
                title="ฝาก ถอน โอนไปบัญชีอื่น หรือดูรายการเดินบัญชี"
                className="shrink-0 w-9 h-9 rounded-ctl border border-hairline bg-white flex items-center justify-center text-muted hover:text-ink hover:bg-paper"
              >
                <Icon name="more_vert" size={18} />
              </button>
            </div>
          ))}
        </div>
      )}

      {menuAccount && (
        <WalletItemPopup kind="bank" item={menuAccount} onClose={() => setMenuAccount(null)} />
      )}
    </div>
  )
}
