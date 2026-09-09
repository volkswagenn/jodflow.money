import { useEffect, useState } from 'react'
import Icon from '../components/shared/Icon'
import { loadPlatformSettings } from '../lib/api/platform'
import { useAuth } from './AuthProvider'
import LoginPage from './LoginPage'
import SignupPage from './SignupPage'
import ForgotPasswordPage from './ForgotPasswordPage'
import ChangePasswordPage from './ChangePasswordPage'

/** หน้าจอเต็มสำหรับสถานะที่ยังเข้าแอปไม่ได้ (โหลดอยู่ / พัง / ยังไม่มีร้าน / หมดอายุ) */
function FullScreen({ icon, tone = 'ink', title, detail, children }) {
  const toneClass =
    tone === 'error' ? 'bg-expense-soft text-expense' : tone === 'warn' ? 'bg-pending-soft text-pending' : 'bg-ink text-lime'
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-[400px] text-center">
        <div className={`w-14 h-14 rounded-panel flex items-center justify-center mx-auto mb-4 ${toneClass}`}>
          <Icon name={icon} size={28} />
        </div>
        <h1 className="text-[17px] font-semibold text-ink">{title}</h1>
        {detail && <p className="text-body text-muted mt-2 leading-relaxed">{detail}</p>}
        {children && <div className="mt-6 flex flex-col gap-2.5">{children}</div>}
      </div>
    </div>
  )
}

const thaiDate = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })
    : null

/**
 * หน้าจอก่อนล็อกอิน — สลับกันเองด้วย state ไม่ใช่ URL
 *
 * เพราะสามหน้านี้อยู่นอก RouterProvider (ดู main.jsx) การใส่ router ซ้อนอีกชั้น
 * เพื่อสามหน้านี้ทำให้ต้องดูแล router สองตัวที่กติกาไม่เหมือนกัน — ไม่คุ้ม
 */
function AuthScreens() {
  const [view, setView] = useState('login') // login | signup | forgot
  const [platform, setPlatform] = useState({ trialDays: 14, signupOpen: true, signupNote: null })

  // อ่านค่าตั้งแบบเงียบๆ — ถ้าอ่านไม่ได้ (เน็ตหลุด / ยังไม่ได้รัน users.sql)
  // ให้ใช้ค่าปริยายไปก่อน ห้ามบล็อกหน้าล็อกอินเพราะเรื่องนี้
  useEffect(() => {
    let alive = true
    loadPlatformSettings()
      .then((s) => alive && setPlatform(s))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  if (view === 'signup') {
    return (
      <SignupPage
        onGoLogin={() => setView('login')}
        trialDays={platform.trialDays}
        signupNote={platform.signupNote}
      />
    )
  }
  if (view === 'forgot') return <ForgotPasswordPage onGoLogin={() => setView('login')} />

  return (
    <LoginPage
      onGoSignup={() => setView('signup')}
      onGoForgot={() => setView('forgot')}
      signupOpen={platform.signupOpen}
    />
  )
}

export default function AuthGate({ children }) {
  const { status, error, retry, signOut, user, shop, blockReason } = useAuth()

  // สถานะตอนติดตั้งครั้งแรก — ยังไม่ได้ใส่ค่า Supabase
  if (status === 'unconfigured') {
    return (
      <FullScreen icon="settings" tone="error" title="ยังตั้งค่าไม่เสร็จ">
        <div className="text-left text-body text-muted leading-relaxed space-y-3">
          <p>เปิดไฟล์ <code className="px-1.5 py-0.5 rounded bg-white border border-hairline text-ink">.env.local</code> ที่โฟลเดอร์โปรเจกต์ แล้วใส่ค่า 2 ตัวนี้:</p>
          <pre className="text-[12px] bg-white border border-hairline rounded-ctl p-3 overflow-x-auto text-ink">
{`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...`}
          </pre>
          <p>
            ค่าทั้งสองอยู่ที่ Supabase → <b className="text-ink">Settings → API</b>
            {' '}(ใช้ตัวที่เขียนว่า <b className="text-ink">anon public</b> เท่านั้น)
          </p>
          <p className="text-label">
            แก้แล้วต้องหยุด <code className="text-ink">npm run dev</code> แล้วสั่งใหม่ — Vite ไม่โหลดไฟล์ .env ซ้ำให้เอง
          </p>
        </div>
      </FullScreen>
    )
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <div className="text-center">
          <div className="w-9 h-9 mx-auto mb-3 rounded-full border-[3px] border-hairline border-t-ink animate-spin" />
          <p className="text-label text-muted">กำลังโหลด…</p>
        </div>
      </div>
    )
  }

  if (status === 'anon') return <AuthScreens />

  // เข้าด้วยรหัสชั่วคราว — ต้องตั้งรหัสของตัวเองก่อน ยังไม่โหลดร้าน ยังไม่เห็นข้อมูลอะไร
  if (status === 'must-change') return <ChangePasswordPage />

  if (status === 'error') {
    return (
      <FullScreen
        icon="cloud_off"
        tone="error"
        title="เชื่อมต่อระบบไม่ได้"
        detail={error ?? 'โหลดข้อมูลร้านไม่สำเร็จ'}
      >
        <button
          onClick={retry}
          className="h-11 rounded-ctl bg-ink text-white text-body font-semibold hover:bg-[#24282F]"
        >
          ลองใหม่
        </button>
        <button onClick={signOut} className="h-11 rounded-ctl border border-hairline text-body text-muted hover:bg-white">
          ออกจากระบบ
        </button>
      </FullScreen>
    )
  }

  // ── หมดอายุ / ถูกระงับ / ปิดบัญชี ─────────────────────────────────────────
  //
  // ทั้งสามกรณีข้อมูลยังอยู่ครบในฐานข้อมูล ไม่มีอะไรถูกลบ — ต้องเขียนบอกให้ชัด
  // ไม่งั้นผู้ใช้จะเข้าใจว่าของหายแล้วเลิกใช้ไปเลย ทั้งที่แค่ต่ออายุก็กลับมาเหมือนเดิม
  if (status === 'blocked') {
    if (blockReason === 'suspended') {
      return (
        <FullScreen
          icon="pause_circle"
          tone="warn"
          title="บัญชีถูกระงับชั่วคราว"
          detail={shop?.suspend_reason || 'ติดต่อผู้ดูแลระบบเพื่อสอบถามรายละเอียด'}
        >
          <p className="text-label text-faint leading-relaxed">
            ข้อมูลทั้งหมดของคุณยังอยู่ครบ ไม่ได้ถูกลบ พอปลดระงับแล้วจะกลับมาเหมือนเดิมทุกอย่าง
          </p>
          <button onClick={retry} className="h-11 rounded-ctl bg-ink text-white text-body font-semibold hover:bg-[#24282F]">
            ตรวจสอบอีกครั้ง
          </button>
          <button onClick={signOut} className="h-11 rounded-ctl border border-hairline text-body text-muted hover:bg-white">
            ออกจากระบบ
          </button>
        </FullScreen>
      )
    }

    if (blockReason === 'closed') {
      return (
        <FullScreen icon="lock" title="บัญชีนี้ปิดการใช้งานแล้ว" detail="ติดต่อผู้ดูแลระบบหากต้องการเปิดใช้อีกครั้ง">
          <button onClick={signOut} className="h-11 rounded-ctl border border-hairline text-body text-muted hover:bg-white">
            ออกจากระบบ
          </button>
        </FullScreen>
      )
    }

    return (
      <FullScreen
        icon="schedule"
        tone="warn"
        title={shop?.status === 'trial' ? 'หมดช่วงทดลองใช้ฟรีแล้ว' : 'หมดอายุการใช้งานแล้ว'}
        detail={
          shop?.expires_at
            ? `สิทธิ์ใช้งานสิ้นสุดเมื่อ ${thaiDate(shop.expires_at)} — ติดต่อเราเพื่อต่ออายุ แล้วใช้ต่อได้ทันที`
            : 'ติดต่อเราเพื่อต่ออายุการใช้งาน'
        }
      >
        <p className="text-label text-faint leading-relaxed">
          ข้อมูลทั้งหมดของคุณยังอยู่ครบทุกรายการ ไม่ได้ถูกลบ — ต่ออายุเมื่อไหร่ก็กลับมาใช้ต่อจากจุดเดิม
        </p>
        <button onClick={retry} className="h-11 rounded-ctl bg-ink text-white text-body font-semibold hover:bg-[#24282F]">
          ต่ออายุแล้ว — ตรวจสอบอีกครั้ง
        </button>
        <button onClick={signOut} className="h-11 rounded-ctl border border-hairline text-body text-muted hover:bg-white">
          ออกจากระบบ
        </button>
      </FullScreen>
    )
  }

  if (status === 'no-shop') {
    return (
      <FullScreen
        icon="storefront"
        title="บัญชีนี้ยังไม่มีสมุดบัญชี"
        detail={`ล็อกอินสำเร็จแล้วในชื่อ ${user?.email ?? ''} แต่ยังไม่มีข้อมูลผูกกับบัญชีนี้ ติดต่อผู้ดูแลระบบเพื่อเปิดให้`}
      >
        <button
          onClick={retry}
          className="h-11 rounded-ctl bg-ink text-white text-body font-semibold hover:bg-[#24282F]"
        >
          ตรวจสอบอีกครั้ง
        </button>
        <button onClick={signOut} className="h-11 rounded-ctl border border-hairline text-body text-muted hover:bg-white">
          ออกจากระบบ
        </button>
      </FullScreen>
    )
  }

  return children
}
