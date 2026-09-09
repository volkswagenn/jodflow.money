import { useState } from 'react'
import { useAuth } from './AuthProvider'
import AuthShell, { Field, Notice, SubmitButton, TextLink, inputClass } from './AuthShell'
import { MIN_PASSWORD_LENGTH, passwordPairProblem } from '../lib/passwordRules'

/**
 * บังคับตั้งรหัสใหม่ — ขึ้นเมื่อเข้าด้วยรหัสชั่วคราวที่แอดมินออกให้ (must_change_password)
 *
 * ต้องกรอกรหัสชั่วคราวซ้ำเป็น "รหัสเดิม" ด้วย เพราะ RPC ฝั่งฐานยืนยันรหัสเดิมเสมอ
 * (ใครหยิบเครื่องที่เปิดค้างไว้ต้องตั้งรหัสใหม่ทับไม่ได้) และตั้งเสร็จเครื่องอื่นถูกออกจากระบบทั้งหมด
 */
export default function ChangePasswordPage() {
  const { profile, changePassword, signOut } = useAuth()
  const [oldPw, setOldPw] = useState('')
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (busy) return
    setError('')
    const problem = passwordPairProblem(pw1, pw2)
    if (problem) return setError(problem)
    setBusy(true)
    try {
      await changePassword(oldPw, pw1)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="ตั้งรหัสผ่านใหม่"
      subtitle={`บัญชี ${profile?.email ?? ''} เข้าด้วยรหัสชั่วคราว ต้องตั้งรหัสของตัวเองก่อนใช้งาน`}
      footer={
        <p>
          <TextLink onClick={signOut}>ออกจากระบบ</TextLink>
        </p>
      }
    >
      <form onSubmit={handleSubmit}>
        <Field label="รหัสชั่วคราวที่ได้รับ">
          <input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} required autoFocus autoComplete="current-password" className={inputClass} />
        </Field>
        <Field label="รหัสผ่านใหม่" hint={`อย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร — ยาวไว้ก่อน ไม่ต้องมีอักขระพิเศษ`}>
          <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" className={inputClass} />
        </Field>
        <Field label="ยืนยันรหัสผ่านใหม่">
          <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required autoComplete="new-password" className={inputClass} />
        </Field>
        <div className="mt-1">{error && <Notice>{error}</Notice>}</div>
        <SubmitButton busy={busy} busyLabel="กำลังบันทึก…">ตั้งรหัสผ่านและเข้าใช้งาน</SubmitButton>
      </form>
    </AuthShell>
  )
}
