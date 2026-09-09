import { useCallback, useEffect, useState } from 'react'
import Icon from '../components/shared/Icon'
import { useAuth } from './AuthProvider'
import { listMySessions, logoutAll, revokeSession, updateMe } from '../lib/api/auth'
import { MIN_PASSWORD_LENGTH, passwordPairProblem } from '../lib/passwordRules'

const ROLE_LABEL = {
  owner: 'เจ้าของร้าน — จัดการได้ทุกอย่าง',
  editor: 'ผู้บันทึก — บันทึกและแก้ไขข้อมูลได้',
  viewer: 'ผู้ดู — ดูได้อย่างเดียว แก้ไขไม่ได้',
}

/** แปลง user agent เป็นชื่อเครื่องที่คนอ่านออก (แนวเดียวกับ device-label.ts ของ ref) */
function deviceLabel(ua = '') {
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'เครื่อง'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : ''
  return [os, browser].filter(Boolean).join(' · ')
}

const when = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')

function Msg({ msg }) {
  if (!msg) return null
  return (
    <p className={`text-sm rounded-xl px-4 py-2 border ${msg.type === 'ok' ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : 'text-red-600 bg-red-50 border-red-200'}`}>
      {msg.text}
    </p>
  )
}

export default function AccountPanel() {
  const { user, profile, shop, role, changePassword, signOut, retry } = useAuth()

  // ── เปลี่ยนรหัสผ่าน ────────────────────────────────────────────────────
  const [oldPw, setOldPw] = useState('')
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [pwMsg, setPwMsg] = useState(null)
  const [pwBusy, setPwBusy] = useState(false)

  async function handleChangePassword(e) {
    e.preventDefault()
    setPwMsg(null)
    const problem = passwordPairProblem(pw1, pw2)
    if (problem) return setPwMsg({ type: 'error', text: problem })
    setPwBusy(true)
    try {
      await changePassword(oldPw, pw1)
      setOldPw(''); setPw1(''); setPw2('')
      setPwMsg({ type: 'ok', text: 'เปลี่ยนรหัสผ่านแล้ว — เครื่องอื่นที่ล็อกอินไว้ถูกออกจากระบบทั้งหมด' })
    } catch (err) {
      setPwMsg({ type: 'error', text: err.message })
    } finally {
      setPwBusy(false)
    }
  }

  // ── ข้อมูลกู้บัญชี (วันเกิด + เบอร์) ────────────────────────────────────
  const [birthDate, setBirthDate] = useState('')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [idMsg, setIdMsg] = useState(null)
  const [idBusy, setIdBusy] = useState(false)

  async function handleSaveIdentity(e) {
    e.preventDefault()
    setIdMsg(null)
    setIdBusy(true)
    try {
      await updateMe({ birthDate, phone })
      setIdMsg({ type: 'ok', text: 'บันทึกแล้ว — ลืมรหัสผ่านเมื่อไหร่ก็ตั้งใหม่เองได้ทันที' })
      retry()
    } catch (err) {
      setIdMsg({ type: 'error', text: err.message })
    } finally {
      setIdBusy(false)
    }
  }

  // ── เครื่องที่ล็อกอินอยู่ ─────────────────────────────────────────────
  const [sessions, setSessions] = useState(null)
  const loadSessions = useCallback(() => listMySessions().then(setSessions).catch(() => setSessions([])), [])
  useEffect(() => { loadSessions() }, [loadSessions])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="section-title">บัญชีของคุณ</h2>
        <dl className="mt-3 rounded-xl border border-gray-200 divide-y divide-gray-100 text-sm">
          <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-gray-500">อีเมล</dt><dd className="font-medium text-gray-900 text-right break-all">{user?.email}</dd></div>
          <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-gray-500">ชื่อที่แสดง</dt><dd className="font-medium text-gray-900 text-right">{profile?.display_name ?? '—'}</dd></div>
          <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-gray-500">ร้าน</dt><dd className="font-medium text-gray-900 text-right">{shop?.name ?? '—'}</dd></div>
          <div className="flex justify-between gap-4 px-4 py-2.5"><dt className="text-gray-500">สิทธิ์</dt><dd className="font-medium text-gray-900 text-right">{ROLE_LABEL[role] ?? role ?? '—'}</dd></div>
        </dl>
      </div>

      <form onSubmit={handleChangePassword} className="border-t pt-6 space-y-4">
        <div>
          <h2 className="section-title">เปลี่ยนรหัสผ่าน</h2>
          <p className="text-sm text-gray-600 mt-1">ต้องยืนยันรหัสเดิม — เปลี่ยนแล้วเครื่องอื่นที่ล็อกอินไว้จะถูกออกจากระบบ</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 sm:max-w-2xl">
          <div><label className="label">รหัสผ่านเดิม</label><input className="input" type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password" /></div>
          <div><label className="label">รหัสผ่านใหม่</label><input className="input" type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} autoComplete="new-password" placeholder={`อย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`} /></div>
          <div><label className="label">ยืนยันรหัสผ่านใหม่</label><input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" placeholder="พิมพ์ซ้ำอีกครั้ง" /></div>
        </div>
        <Msg msg={pwMsg} />
        <button type="submit" className="btn btn-primary" disabled={pwBusy}>{pwBusy ? 'กำลังบันทึก…' : 'เปลี่ยนรหัสผ่าน'}</button>
      </form>

      <form onSubmit={handleSaveIdentity} className="border-t pt-6 space-y-4">
        <div>
          <h2 className="section-title">ข้อมูลสำหรับกู้บัญชี</h2>
          <p className="text-sm text-gray-600 mt-1">
            {profile?.has_birth_date && profile?.phone
              ? 'บันทึกไว้แล้ว — ลืมรหัสผ่านเมื่อไหร่ก็ยืนยันด้วยวันเกิด + เบอร์นี้แล้วตั้งใหม่เองได้'
              : 'ยังไม่ครบ — ถ้าลืมรหัสผ่านจะต้องรอผู้ดูแลติดต่อกลับ กรอกไว้ตอนนี้จะได้ตั้งใหม่เองได้ทันที'}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 sm:max-w-xl">
          <div><label className="label">วันเกิด{profile?.has_birth_date ? ' (บันทึกไว้แล้ว — กรอกเพื่อเปลี่ยน)' : ''}</label><input className="input" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} /></div>
          <div><label className="label">เบอร์โทร</label><input className="input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812345678" /></div>
        </div>
        <Msg msg={idMsg} />
        <button type="submit" className="btn btn-secondary" disabled={idBusy}>{idBusy ? 'กำลังบันทึก…' : 'บันทึกข้อมูลกู้บัญชี'}</button>
      </form>

      <div className="border-t pt-6 space-y-3">
        <div>
          <h2 className="section-title">เครื่องที่ล็อกอินอยู่</h2>
          <p className="text-sm text-gray-600 mt-1">บัญชีหนึ่งล็อกอินค้างได้ 2 เครื่อง — เครื่องที่ 3 เข้ามา เครื่องที่เก่าที่สุดจะหลุดเอง</p>
        </div>
        {sessions === null && <p className="text-sm text-gray-500">กำลังโหลด…</p>}
        {sessions?.map((s) => (
          <div key={s.id} className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-2.5 text-sm">
            <Icon name="devices" size={19} className="text-gray-500 flex-none" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-gray-900">{deviceLabel(s.user_agent)}{s.is_current && <span className="ml-2 text-xs text-emerald-600">เครื่องนี้</span>}</div>
              <div className="text-xs text-gray-500">ล็อกอิน {when(s.created_at)} · ใช้ล่าสุด {when(s.last_seen_at)}{s.ip && s.ip !== 'unknown' ? ` · ${s.ip}` : ''}</div>
            </div>
            {!s.is_current && (
              <button type="button" className="btn btn-ghost text-red-600 h-8 px-2 text-xs" onClick={() => revokeSession(s.id).then(loadSessions)}>เตะออก</button>
            )}
          </div>
        ))}
      </div>

      <div className="border-t pt-6 flex flex-wrap gap-3">
        <button type="button" onClick={signOut} className="btn btn-ghost text-red-600"><Icon name="logout" size={17} /> ออกจากระบบ</button>
        <button type="button" onClick={() => logoutAll().finally(signOut)} className="btn btn-ghost text-red-600"><Icon name="devices" size={17} /> ออกจากทุกเครื่อง</button>
      </div>
    </div>
  )
}
