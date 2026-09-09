import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { setShopId, setShopRole, setUserId } from '../lib/api/context'
import * as authApi from '../lib/api/auth'
import { configError, supabase, toThaiError } from '../lib/supabase'
import { clearSessionToken, getSessionToken, onSessionTokenChange, setSessionToken } from '../lib/sessionToken'
import { resetStores } from '../store/hydrate'

/**
 * ศูนย์กลางของ "ตอนนี้ใครล็อกอินอยู่ อยู่ร้านไหน สิทธิ์อะไร และร้านนั้นยังใช้ได้ไหม"
 *
 * ระบบล็อกอินเป็นของเราเอง (supabase/users.sql หมวด 3 และ 9) ทำตามแบบ Jodflow.order:
 *   ชั้น 1  มีตั๋วในเครื่องไหม (getSessionToken) — ไม่มี = หน้า login ทันที ไม่ยิงอะไร
 *   ชั้น 2  ตั๋วยังมีชีวิตในฐานไหม (app_me) — ถอนตั๋ว/ปิดบัญชี มีผลทันทีที่โหลดครั้งถัดไป
 *
 * status:
 *   'unconfigured' — ยังไม่ได้ใส่ค่า Supabase ใน .env.local
 *   'loading'      — ยังตอบไม่ได้
 *   'anon'         — ยังไม่ได้ล็อกอิน / ตั๋วถูกถอน → หน้า login / สมัคร / ลืมรหัสผ่าน
 *   'must-change'  — เข้าด้วยรหัสชั่วคราว ต้องตั้งรหัสใหม่ก่อนไปต่อ
 *   'no-shop'      — ล็อกอินแล้วแต่ไม่มีร้าน
 *   'blocked'      — มีร้าน แต่หมดอายุ / ถูกระงับ / ปิดบัญชี → ดู blockReason
 *   'error'        — โหลดไม่สำเร็จ (เน็ตหลุด / ยังไม่ได้รัน users.sql) → มีปุ่มลองใหม่
 *   'ready'        — ใช้งานได้
 *
 * เรื่องสิทธิ์จริงถูกกั้นที่ฐานข้อมูลตลอด — ที่นี่แค่แปลสถานะให้เป็นหน้าจอที่อ่านรู้เรื่อง
 */
export const AuthContext = createContext(null)

/** คีย์ใน sessionStorage — ผูกกับแท็บนี้เท่านั้น ปิดแท็บแล้วหลุดโหมดดูร้านลูกค้าเอง */
const ADMIN_VIEW_KEY = 'adminViewShopId'
const SHOP_FIELDS = 'id, name, status, expires_at, trial_ends_at, suspend_reason, closed_at, created_at'

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth ต้องอยู่ภายใต้ <AuthProvider>')
  return ctx
}

/** ร้านนี้ยังเข้าใช้ได้ไหม — ต้องตรงกับ shop_is_open() ใน supabase/users.sql เป๊ะ */
export function shopIsOpen(shop) {
  if (!shop) return false
  if (shop.status !== 'trial' && shop.status !== 'active') return false
  if (!shop.expires_at) return true
  return new Date(shop.expires_at).getTime() > Date.now()
}

/** เหลืออีกกี่วัน (ปัดขึ้น) — null = ไม่มีวันหมดอายุ */
export function daysLeft(shop) {
  if (!shop?.expires_at) return null
  return Math.ceil((new Date(shop.expires_at).getTime() - Date.now()) / 86_400_000)
}

function blockReasonOf(shop) {
  if (shop.status === 'suspended') return 'suspended'
  if (shop.status === 'closed') return 'closed'
  return 'expired'
}

async function loadMembership(userId) {
  const { data, error } = await supabase
    .from('shop_members')
    .select(`role, shop:shops!inner(${SHOP_FIELDS})`)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw new Error(toThaiError(error))
  return data?.[0] ?? null
}

/** โหลดร้านของลูกค้าที่แอดมินกดเปิดดู — ผ่าน RLS ได้เพราะ is_platform_admin() */
async function loadShopById(shopId) {
  const { data, error } = await supabase.from('shops').select(SHOP_FIELDS).eq('id', shopId).maybeSingle()
  if (error) throw new Error(toThaiError(error))
  return data
}

const EMPTY = { profile: null, shop: null, role: null, error: null, blockReason: null }

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', ...EMPTY })
  const [reloadKey, setReloadKey] = useState(0)
  const [adminViewShopId, setAdminViewShopId] = useState(() => sessionStorage.getItem(ADMIN_VIEW_KEY))

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  // ล็อกอิน/ออกจากอีกแท็บ → แท็บนี้ตามให้ทัน ไม่ค้างเป็นข้อมูลของคนก่อน
  useEffect(() => onSessionTokenChange(() => {
    resetStores()
    setShopId(null)
    reload()
  }), [reload])

  useEffect(() => {
    if (configError) {
      setState({ status: 'unconfigured', ...EMPTY, error: configError })
      return
    }
    if (!getSessionToken()) {
      setShopId(null)
      setUserId(null)
      setState({ status: 'anon', ...EMPTY })
      return
    }

    let alive = true
    setState((s) => ({ ...s, status: 'loading', error: null }))

    ;(async () => {
      const me = await authApi.me()
      if (!me) {
        // ตั๋วในเครื่องมี แต่ฐานบอกว่าตายแล้ว (ถอน / หมดอายุ / บัญชีปิด) → ทิ้งตั๋ว
        clearSessionToken()
        return { status: 'anon' }
      }
      const profile = {
        id: me.id,
        email: me.email,
        display_name: me.display_name,
        is_platform_admin: Boolean(me.is_platform_admin),
        has_birth_date: Boolean(me.has_birth_date),
        phone: me.phone ?? null,
      }
      setUserId(me.id)
      if (me.must_change_password) return { status: 'must-change', profile }

      // แอดมินกดเปิดดูร้านลูกค้า — สลับไปผูกกับร้านนั้นแทน
      if (adminViewShopId && profile.is_platform_admin) {
        const target = await loadShopById(adminViewShopId)
        if (target) return { status: 'shop', profile, shop: target, role: 'owner', adminView: true }
        sessionStorage.removeItem(ADMIN_VIEW_KEY)
      }
      const m = await loadMembership(me.id)
      return { status: 'shop', profile, shop: m?.shop ?? null, role: m?.role ?? null, adminView: false }
    })()
      .then((r) => {
        if (!alive) return
        if (r.status === 'anon') {
          setShopId(null)
          setUserId(null)
          setState({ status: 'anon', ...EMPTY })
          return
        }
        if (r.status === 'must-change') {
          setShopId(null)
          setState({ status: 'must-change', ...EMPTY, profile: r.profile })
          return
        }
        if (!r.shop) {
          setShopId(null)
          setState({ status: 'no-shop', ...EMPTY, profile: r.profile })
          return
        }
        // แอดมินต้องเข้าได้แม้ร้านลูกค้าหมดอายุ — นั่นคือเวลาที่ต้องเข้าไปดูที่สุด
        if (!r.adminView && !shopIsOpen(r.shop)) {
          setShopId(null)
          setState({ status: 'blocked', ...EMPTY, profile: r.profile, shop: r.shop, role: r.role, blockReason: blockReasonOf(r.shop) })
          return
        }
        // ต้องตั้งก่อน render แอป เพราะทุก api/* อ่าน shopId จากตรงนี้
        setShopId(r.shop.id)
        setShopRole(r.role)
        setState({ status: 'ready', ...EMPTY, profile: r.profile, shop: r.shop, role: r.role })
      })
      .catch((err) => {
        if (alive) setState({ status: 'error', ...EMPTY, error: err.message })
      })

    return () => {
      alive = false
    }
  }, [reloadKey, adminViewShopId])

  const signIn = useCallback(async (email, password) => {
    const r = await authApi.login(email, password)
    setSessionToken(r.token)
    reload()
  }, [reload])

  /**
   * สมัคร = ฐานข้อมูลสร้าง บัญชี + โปรไฟล์ + ร้าน + ตั๋ว ในธุรกรรมเดียว (app_signup)
   * วันทดลอง 14 วันไม่ได้ส่งจากที่นี่ — trigger ฝั่งฐานใส่ให้เอง ใครแก้ค่าที่ส่งไปก็ไม่มีผล
   */
  const signUp = useCallback(async (form) => {
    const r = await authApi.signup(form)
    setSessionToken(r.token)
    reload()
  }, [reload])

  const signOut = useCallback(async () => {
    // ล้าง store ก่อนตัดตั๋ว — ไม่งั้นข้อมูลร้านเดิมยังค้างในหน่วยความจำให้คนถัดไปเห็นชั่วขณะ
    resetStores()
    setShopId(null)
    setUserId(null)
    sessionStorage.removeItem(ADMIN_VIEW_KEY)
    setAdminViewShopId(null)
    try {
      await authApi.logout()
    } catch {
      // ออฟไลน์ก็ต้องออกจากหน้าจอให้จริง — ตั๋วฝั่งฐานจะหมดอายุเองใน 30 วัน
    } finally {
      clearSessionToken()
      reload()
    }
  }, [reload])

  const changePassword = useCallback(async (oldPassword, newPassword) => {
    await authApi.changePassword(oldPassword, newPassword)
    reload() // ปลดสถานะ must-change และโหลดร้าน
  }, [reload])

  /** แอดมินเปิดดูร้านลูกค้า — บันทึกลง audit log ก่อนเสมอ เขียนไม่สำเร็จก็ไม่เปิด */
  const enterShopView = useCallback(async (shopId) => {
    const { error } = await supabase.rpc('admin_log_action', { p_shop: shopId, p_action: 'VIEW_SHOP', p_detail: null })
    if (error) throw new Error(toThaiError(error))
    resetStores()
    setShopId(null)
    sessionStorage.setItem(ADMIN_VIEW_KEY, shopId)
    setAdminViewShopId(shopId)
  }, [])

  const leaveShopView = useCallback(() => {
    resetStores()
    setShopId(null)
    sessionStorage.removeItem(ADMIN_VIEW_KEY)
    setAdminViewShopId(null)
  }, [])

  const isAdminView = Boolean(adminViewShopId) && state.status === 'ready'

  const value = useMemo(
    () => ({
      ...state,
      // โค้ดเดิมหลายที่อ่าน user.email — คงรูปนี้ไว้
      user: state.profile ? { id: state.profile.id, email: state.profile.email } : null,
      shopId: state.shop?.id ?? null,
      canEdit: state.role === 'owner' || state.role === 'editor',
      isOwner: state.role === 'owner',
      isPlatformAdmin: Boolean(state.profile?.is_platform_admin),
      isAdminView,
      shopDaysLeft: daysLeft(state.shop),
      signIn,
      signUp,
      signOut,
      changePassword,
      enterShopView,
      leaveShopView,
      retry: reload,
    }),
    [state, isAdminView, signIn, signUp, signOut, changePassword, enterShopView, leaveShopView, reload]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
