import Icon from '../components/shared/Icon'

/**
 * โครงหน้าจอของทุกหน้าก่อนเข้าแอป (ล็อกอิน · สมัคร · ลืมรหัสผ่าน)
 *
 * แยกออกมาเพราะสามหน้านี้อยู่ "นอก router" (ดู main.jsx — RouterProvider อยู่ข้างใน
 * AuthGate อีกที) จึงใช้ layout ของแอปไม่ได้ ถ้าไม่รวมโครงไว้ที่เดียว โลโก้กับระยะขอบ
 * ของแต่ละหน้าจะเพี้ยนกันทีละนิดทุกครั้งที่แก้หน้าใดหน้าหนึ่ง
 */
export default function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-[400px]">
        <div className="text-center mb-7">
          <div className="w-14 h-14 rounded-panel bg-ink flex items-center justify-center mx-auto mb-3.5">
            <Icon name="account_balance_wallet" size={28} className="text-lime" />
          </div>
          <h1 className="text-[22px] font-semibold text-ink">{title ?? 'JodFlow'}</h1>
          <p className="text-label text-muted mt-1">{subtitle ?? 'ระบบบันทึกรายรับ-รายจ่าย'}</p>
        </div>

        <div className="bg-white rounded-card border border-hairline shadow-card p-6">{children}</div>

        {footer && <div className="text-center text-label text-muted mt-5 leading-relaxed">{footer}</div>}
      </div>
    </div>
  )
}

/** ช่องกรอกมาตรฐานของหน้าจอกลุ่มนี้ */
export function Field({ label, hint, children }) {
  return (
    <label className="block mb-4">
      <span className="block text-label font-medium text-ink mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-faint mt-1.5 leading-relaxed">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full h-11 px-3.5 rounded-ctl border border-hairline text-body focus:outline-none focus:border-ink'

/** กล่องข้อความแจ้งผล — สีแดงเมื่อผิดพลาด สีเขียวเมื่อสำเร็จ */
export function Notice({ tone = 'error', children }) {
  const cls =
    tone === 'ok'
      ? 'bg-income-soft text-income'
      : tone === 'info'
        ? 'bg-[#F6F5F1] text-muted'
        : 'bg-expense-soft text-expense'
  return (
    <div className={`mb-4 px-3.5 py-2.5 rounded-ctl text-label flex gap-2 leading-relaxed ${cls}`}>
      <Icon name={tone === 'ok' ? 'check_circle' : tone === 'info' ? 'info' : 'error'} size={17} className="flex-none mt-px" />
      <span>{children}</span>
    </div>
  )
}

/** ปุ่มหลักเต็มความกว้าง */
export function SubmitButton({ busy, children, busyLabel }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="w-full h-11 rounded-ctl bg-ink text-white text-body font-semibold
                 hover:bg-[#24282F] disabled:opacity-55 disabled:cursor-not-allowed"
    >
      {busy ? (busyLabel ?? 'กำลังทำรายการ…') : children}
    </button>
  )
}

/** ลิงก์ข้อความในส่วนท้าย — เป็นปุ่มจริง เพราะสลับหน้าด้วย state ไม่ใช่ URL */
export function TextLink({ onClick, children }) {
  return (
    <button type="button" onClick={onClick} className="font-semibold text-ink hover:underline">
      {children}
    </button>
  )
}
