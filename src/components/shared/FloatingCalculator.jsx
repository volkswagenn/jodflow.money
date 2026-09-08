import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'
import UiIcon from './UiIcon'

/**
 * เครื่องคิดเลขลอย — วงกลมที่อยู่ทุกหน้า กดแล้วกางเป็นเครื่องคิดเลข
 *
 * ทำไมต้องลอยอยู่ทุกหน้า ไม่ใช่หน้าใครหน้ามัน
 *   คนคีย์บิลต้องบวกเลขตลอด (ค่าส่ง + ค่าของ, ถอด VAT, หารบิลกับเพื่อน) ถ้าต้อง
 *   ออกจากฟอร์มไปเปิดเครื่องคิดเลขของเครื่อง ข้อมูลที่กรอกค้างไว้จะหลุดสายตา
 *   และต้องจำตัวเลขข้ามแอปเอง ซึ่งเป็นจุดที่คนกรอกผิดบ่อยที่สุด
 *
 * กติกาการโต้ตอบ (ตาม mockup ที่ตกลงกันไว้)
 *   วงกลม  กดสั้น = เปิด · กดค้าง = ลากไปวางที่ไหนก็ได้ · จำตำแหน่งไว้
 *   แถบหัว ลากเพื่อย้ายกล่อง (จำตำแหน่งแยกจากวงกลม)
 *   นอกกล่อง กดแล้วพับกลับเป็นวงกลม — ยกเว้นปักหมุดไว้
 *   ปักหมุด ปุ่มขวาบน เปิดค้างจนกว่าจะกดเลิก (ใช้ตอนเปิดฟอร์มแล้วคิดเลขไปด้วย)
 *   ประวัติ แถบสไลด์ออกทางซ้าย บรรทัดบนคือโจทย์ บรรทัดล่างคือผลลัพธ์ที่กดกลับมาใช้ได้
 *
 * z-index สูงกว่าป๊อปอัป (z-70) ตั้งใจ — เคสหลักคือเปิดฟอร์มค้างไว้แล้วคิดเลข
 * ถ้าเครื่องคิดเลขไปอยู่ใต้ป๊อปอัปก็ใช้ตอนที่ต้องใช้จริงไม่ได้เลย
 */

const FAB = 56
const EDGE = 12          // ระยะห่างขอบจอที่ยอมให้เข้าใกล้ที่สุด
const HOLD = 280         // กดค้างกี่ ms ถึงนับว่า "ยกขึ้นลาก"
const MOVE = 5           // ขยับเกินกี่ px ถึงนับว่าลาก
const TAP = 10           // ปล่อยนิ้วโดยขยับไม่เกินนี้ = ตั้งใจแตะ (นิ้วสั่นได้)
const HIST_W = 172
const BOTTOM_BAR = 68    // แถบเมนูล่างของมือถือ — ตำแหน่งเริ่มต้นของวงกลมต้องไม่ทับ

const store = {
  get(k, d) { try { const v = localStorage.getItem('calc:' + k); return v == null ? d : JSON.parse(v) } catch { return d } },
  set(k, v) { try { localStorage.setItem('calc:' + k, JSON.stringify(v)) } catch {} },
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v))
const round2 = (n) => Math.round(n * 100) / 100
/** เลขในบรรทัดโจทย์ — ไม่ใส่คอมมา ให้อ่านเป็นสมการตรงๆ ("25+156") */
const plain = (n) => String(Math.round(Number(n) * 1e8) / 1e8)
const money = (n) => Number(n).toLocaleString('th-TH', { maximumFractionDigits: 8 })

const EMPTY = { acc: null, op: null, cur: '0', fresh: true }
const OPS = ['+', '−', '×', '÷']
const apply = (a, b, o) =>
  o === '+' ? a + b : o === '−' ? a - b : o === '×' ? a * b : o === '÷' ? (b === 0 ? NaN : a / b) : b

const PAD = [
  { k: 'AC', cls: 'fn' }, { k: '±', cls: 'fn' }, { k: '%', cls: 'fn' }, { k: '÷', cls: 'op' },
  { k: '7' }, { k: '8' }, { k: '9' }, { k: '×', cls: 'op' },
  { k: '4' }, { k: '5' }, { k: '6' }, { k: '−', cls: 'op' },
  { k: '1' }, { k: '2' }, { k: '3' }, { k: '+', cls: 'op' },
  { k: '0', wide: true }, { k: '.' }, { k: '=', cls: 'eq' },
]

/**
 * ลิ้นชักข้างเครื่องคิดเลข (ประวัติ / โน๊ต)
 *
 * ซ้อนกันได้: ถ้าประวัติกางอยู่แล้วเปิดโน๊ต โน๊ตจะไปโผล่ถัดจากประวัติอีกชั้น
 * (depth = ชั้นที่เท่าไร) ไม่ใช่ทับกัน — สองอย่างนี้ใช้คู่กันบ่อย เช่นจดยอดจากบิล
 * ไว้ในโน๊ต แล้วไล่บวกทีละยอดโดยดูประวัติว่าบวกไปถึงไหนแล้ว
 */
function Drawer({ open, side, depth, overlay, title, action, children }) {
  const gap = 8 + depth * (HIST_W + 8)

  // จอแคบ (มือถือ) ไม่มีที่ให้กางข้างๆ — เครื่องคิดเลขกว้าง 268 บวกลิ้นชักอีก 180
  // เกินความกว้างจอไปแล้ว จึงเลื่อนมาทับตัวเครื่องแทน ตอนอ่านรายการก็ไม่ได้กดเลขอยู่ดี
  if (overlay) {
    return (
      // เริ่มใต้แถบหัว (42px) ไม่ทับปุ่มโน๊ต/ประวัติ/ปักหมุด/ปิด ไม่งั้นเปิดแล้วปิดไม่ได้
      // และตอนปิดต้องจางหายด้วย ไม่ใช่แค่เลื่อนออก เพราะกรอบนอก (.calc) ไม่ได้ตัดของที่ล้น
      // (ตั้งใจ เพื่อให้ลิ้นชักแบบกางข้างโผล่ออกไปได้) ถ้าไม่จางจะเห็นแผ่นขาวค้างอยู่ริมจอ
      <aside
        className={`absolute left-0 right-0 bottom-0 top-[42px] z-[2] bg-white rounded-b-[18px]
          flex flex-col overflow-hidden transition-[transform,opacity] duration-200 ease-[cubic-bezier(.2,.9,.3,1)]
          ${open ? 'translate-x-0 opacity-100' : '-translate-x-[calc(100%+16px)] opacity-0 pointer-events-none'}`}
      >
        <div className="h-[38px] flex-none flex items-center gap-1.5 pl-3 pr-2 bg-[#FAF9F6] border-b border-[#EFEDE7]">
          <span className="flex-1 text-[12px] font-semibold">{title}</span>
          {action}
        </div>
        {children}
      </aside>
    )
  }

  return (
    <aside
      style={side === 'right' ? { left: `calc(100% + ${gap}px)` } : { right: `calc(100% + ${gap}px)` }}
      className={`absolute top-0 h-full w-[172px] bg-white border border-hairline rounded-[16px]
        shadow-[0_18px_60px_rgba(22,24,29,.22)] flex flex-col overflow-hidden z-0
        transition-[transform,opacity] duration-200 ease-[cubic-bezier(.2,.9,.3,1)]
        ${side === 'right' ? 'origin-left' : 'origin-right'}
        ${open
          ? 'translate-x-0 scale-100 opacity-100'
          : `${side === 'right' ? '-translate-x-6' : 'translate-x-6'} scale-95 opacity-0 pointer-events-none`}`}
    >
      <div className="h-[42px] flex-none flex items-center gap-1.5 pl-3 pr-2 bg-[#FAF9F6] border-b border-[#EFEDE7]">
        <span className="flex-1 text-[12px] font-semibold">{title}</span>
        {action}
      </div>
      {children}
    </aside>
  )
}

// ทุกแบบต้องระบุ พื้น/ขอบ/สีอักษร ครบในชุดเดียว — ถ้าใส่ค่าเริ่มต้นไว้ในคลาสฐานแล้ว
// ให้แบบอื่นมาทับ Tailwind จะเลือกอันที่ชนะตามลำดับใน CSS ไม่ใช่ลำดับที่เขียน
// (เคยเจอ: ปุ่ม = ได้ text-white แต่พื้นยังเป็น bg-white เลยกลายเป็นปุ่มว่างเปล่า)
const KEY_BASE = 'h-[41px] rounded-ctl border font-semibold tabular-nums active:translate-y-px'
const KEY_CLASS = {
  num: 'bg-white border-hairline text-ink text-[16px]',
  op: 'bg-paper border-hairline text-ink text-[16px]',
  fn: 'bg-paper border-hairline text-muted text-[14px]',
  eq: 'bg-ink border-ink text-white text-[16px]',
}

export default function FloatingCalculator() {
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [pinned, setPinned] = useState(() => store.get('pinned', false))
  const [histOpen, setHistOpen] = useState(() => store.get('histOpen', false))
  const [history, setHistory] = useState(() => store.get('history', []))
  const [notesOpen, setNotesOpen] = useState(() => store.get('notesOpen', false))
  const [note, setNote] = useState(() => store.get('note', ''))
  const [flipDrawers, setFlipDrawers] = useState(false)
  // จอแคบ = ลิ้นชักเลื่อนมาทับตัวเครื่องแทนการกางข้างๆ และเปิดได้ทีละอัน
  const [narrow, setNarrow] = useState(() => window.innerWidth < 640)

  const fabRef = useRef(null)
  const panelRef = useRef(null)
  // ตำแหน่งเก็บใน ref ไม่ใช่ state — ระหว่างลากต้องขยับทุกเฟรม ถ้า re-render ทั้งกล่อง
  // (ปุ่ม 19 ปุ่ม + ประวัติ) ทุกเฟรม การลากจะสะดุดบนมือถือ
  const fabPos = useRef(store.get('fab', null))
  const panelPos = useRef(store.get('panel', null))

  const calc = useRef({ ...EMPTY })
  const [, force] = useState(0)
  const rerender = useCallback(() => force((n) => n + 1), [])

  const defaultFab = () => ({
    x: window.innerWidth - FAB - 18,
    y: window.innerHeight - FAB - BOTTOM_BAR - 18,
  })

  const placeFab = useCallback(() => {
    const el = fabRef.current
    if (!el) return
    if (!fabPos.current) fabPos.current = defaultFab()
    const p = fabPos.current
    p.x = clamp(p.x, EDGE, window.innerWidth - FAB - EDGE)
    p.y = clamp(p.y, EDGE, window.innerHeight - FAB - EDGE)
    el.style.left = p.x + 'px'
    el.style.top = p.y + 'px'
  }, [])

  /**
   * ลิ้นชักกางไปทางไหน — ปกติซ้าย ถ้าซ้ายไม่พอ (นับรวมกรณีกางสองชั้น) ก็สลับไปขวา
   * ไม่งั้นแถบจะโผล่นอกจอแล้วอ่านไม่ได้ทั้งแถบ
   */
  // เปิดค้างไว้สองอันจากจอใหญ่ แล้วมาเปิดในจอแคบ — ที่มีให้ทับได้แค่อันเดียว
  useEffect(() => {
    if (narrow && histOpen && notesOpen) { setNotesOpen(false); store.set('notesOpen', false) }
  }, [narrow, histOpen, notesOpen])

  const openCount = (histOpen ? 1 : 0) + (notesOpen ? 1 : 0)
  const needRef = useRef(0)
  needRef.current = Math.max(1, openCount) * (HIST_W + 8)
  const fitDrawers = useCallback((x) => setFlipDrawers(x - needRef.current < EDGE), [])

  /** วางกล่อง: เคยลากเองก็อยู่ที่เดิม ไม่เคยก็กางออกจากวงกลมด้านที่มีที่ว่าง */
  const placePanel = useCallback(() => {
    const el = panelRef.current
    if (!el) return
    const w = el.offsetWidth, h = el.offsetHeight
    const f = fabPos.current ?? defaultFab()
    let x, y
    if (panelPos.current) {
      x = panelPos.current.x
      y = panelPos.current.y
    } else {
      const right = f.x + FAB / 2 > window.innerWidth / 2
      const below = f.y + FAB / 2 < window.innerHeight / 2
      x = right ? f.x + FAB - w : f.x
      y = below ? f.y + FAB + 10 : f.y - h - 10
      // มุมที่กล่อง "งอกออกมา" ต้องเป็นมุมที่ติดกับวงกลม ภาพถึงต่อเนื่อง
      el.style.transformOrigin = `${right ? '100%' : '0%'} ${below ? '0%' : '100%'}`
    }
    x = clamp(x, EDGE, window.innerWidth - w - EDGE)
    y = clamp(y, EDGE, window.innerHeight - h - EDGE)
    el.style.left = x + 'px'
    el.style.top = y + 'px'
    fitDrawers(x)
  }, [])

  useLayoutEffect(() => { placeFab() }, [placeFab, open, closing])
  useLayoutEffect(() => { if (open) placePanel() }, [open, placePanel])
  // เปิด/ปิดลิ้นชักแล้วที่ว่างด้านซ้ายที่ต้องใช้เปลี่ยน ต้องคิดด้านใหม่ทุกครั้ง
  useEffect(() => {
    const el = panelRef.current
    if (el) fitDrawers(parseFloat(el.style.left) || 0)
  }, [histOpen, notesOpen, fitDrawers])

  useEffect(() => {
    const onResize = () => { setNarrow(window.innerWidth < 640); placeFab(); placePanel() }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [placeFab, placePanel])

  // ── ลากของชิ้นหนึ่ง ────────────────────────────────────────────
  /**
   * @param opts.hold   ต้องกดค้างก่อนถึงลากได้ (ใช้กับวงกลม เพราะกดสั้น = เปิด)
   * @param opts.onTap  กดสั้นโดยแทบไม่ขยับ
   */
  function dragHandlers({ box, move, hold = false, onTap, onDrop }) {
    const st = { id: null, sx: 0, sy: 0, bx: 0, by: 0, w: 0, h: 0, dist: 0, dragging: false, timer: null }
    const lift = (el, on) => el?.classList.toggle('is-lifted', on)

    return {
      onPointerDown: (e) => {
        if (e.button != null && e.button !== 0) return
        // กดโดนปุ่มลูกที่อยู่บนที่จับ (โน๊ต ประวัติ ปักหมุด ปิด) = ไม่ใช่การลาก
        //
        // สำคัญมาก: ถ้าปล่อยให้ที่จับเรียก setPointerCapture ตอนกดปุ่มลูก เบราว์เซอร์
        // จะส่ง pointer ต่อไปให้ตัวที่จับ แล้ว "ไม่ยิง click ให้ปุ่มลูกเลย" ปุ่มบนแถบหัว
        // จึงกดไม่ติดทั้งแถบ (เทสต์ด้วย .click() ไม่เจอ เพราะไม่ได้ผ่าน pointer)
        const btn = e.target.closest?.('button, a, input, textarea, select')
        if (btn && btn !== e.currentTarget) return
        const b = box()
        st.bx = b.x; st.by = b.y; st.w = b.w; st.h = b.h
        st.sx = e.clientX; st.sy = e.clientY
        st.dist = 0; st.dragging = false; st.id = e.pointerId
        st.el = e.currentTarget
        // ตั้งเวลากดค้างก่อนจับ pointer เสมอ — จับพลาดแล้ว throw ได้ ถ้ายังไม่ตั้งเวลาจะลากไม่ได้เลย
        if (hold) {
          st.ready = false
          st.timer = setTimeout(() => {
            st.ready = true
            lift(st.el, true)
            navigator.vibrate?.(8)
          }, HOLD)
        } else {
          st.ready = true
        }
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ไม่จับก็ยังลากได้ */ }
      },
      onPointerMove: (e) => {
        if (st.id == null) return
        const dx = e.clientX - st.sx, dy = e.clientY - st.sy
        st.dist = Math.max(st.dist, Math.hypot(dx, dy))
        if (!st.dragging && st.dist > MOVE) {
          if (!hold) { st.dragging = true; lift(st.el, true) }
          else if (st.ready) st.dragging = true
        }
        if (!st.dragging) return
        e.preventDefault()
        move(
          clamp(st.bx + dx, EDGE, window.innerWidth - st.w - EDGE),
          clamp(st.by + dy, EDGE, window.innerHeight - st.h - EDGE),
        )
      },
      onPointerUp: (e) => {
        if (st.id == null) { lift(st.el, false); return }
        clearTimeout(st.timer)
        try { e.currentTarget.releasePointerCapture(st.id) } catch { /* ปล่อยไม่ได้ก็ไม่เป็นไร */ }
        const wasDrag = st.dragging
        const wasTap = !wasDrag && st.dist <= TAP
        st.id = null; st.ready = false; st.dragging = false
        lift(st.el, false)
        if (wasTap) onTap?.()
        else if (wasDrag) onDrop?.()
      },
      onPointerCancel: (e) => {
        clearTimeout(st.timer)
        st.id = null; st.dragging = false
        lift(e.currentTarget, false)
      },
    }
  }

  const fabDrag = useRef(null)
  if (!fabDrag.current) {
    fabDrag.current = dragHandlers({
      box: () => ({ ...(fabPos.current ?? defaultFab()), w: FAB, h: FAB }),
      move: (x, y) => {
        fabPos.current = { x, y }
        const el = fabRef.current
        if (el) { el.style.left = x + 'px'; el.style.top = y + 'px' }
      },
      hold: true,
      onTap: () => setOpen((v) => !v),
      onDrop: () => store.set('fab', fabPos.current),
    })
  }

  const barDrag = useRef(null)
  if (!barDrag.current) {
    barDrag.current = dragHandlers({
      box: () => {
        const r = panelRef.current.getBoundingClientRect()
        return { x: r.left, y: r.top, w: r.width, h: r.height }
      },
      move: (x, y) => {
        panelPos.current = { x, y }
        const el = panelRef.current
        el.style.left = x + 'px'
        el.style.top = y + 'px'
        fitDrawers(x)
      },
      onDrop: () => store.set('panel', panelPos.current),
    })
  }

  // ── ตรรกะเครื่องคิดเลข ─────────────────────────────────────────
  const remember = useCallback((expr, res) => {
    setHistory((h) => {
      const next = [{ expr, res }, ...h].slice(0, 40)
      store.set('history', next)
      return next
    })
  }, [])

  const press = useCallback((k) => {
    const s = calc.current
    if (/^[0-9]$/.test(k)) {
      s.cur = s.fresh || s.cur === '0' ? k : s.cur + k
      s.fresh = false
    } else if (k === '.') {
      if (s.fresh) { s.cur = '0.'; s.fresh = false } else if (!s.cur.includes('.')) s.cur += '.'
    } else if (k === 'AC') {
      Object.assign(s, EMPTY)
    } else if (k === '⌫') {
      s.cur = s.cur.length > 1 ? s.cur.slice(0, -1) : '0'
    } else if (k === '±') {
      s.cur = String(-Number(s.cur))
    } else if (k === '%') {
      s.cur = String(Number(s.cur) / 100); s.fresh = true
    } else if (OPS.includes(k)) {
      if (s.op != null && !s.fresh) s.acc = apply(Number(s.acc), Number(s.cur), s.op)
      else if (s.acc == null) s.acc = Number(s.cur)
      s.op = k; s.fresh = true; s.cur = String(s.acc)
    } else if (k === '=') {
      if (s.op != null) {
        const line = plain(s.acc) + s.op + plain(s.cur)     // "25+156"
        const r = apply(Number(s.acc), Number(s.cur), s.op)
        s.cur = Number.isFinite(r) ? String(r) : 'หารด้วยศูนย์ไม่ได้'
        s.acc = null; s.op = null; s.fresh = true
        if (Number.isFinite(r)) remember(line, r)
      }
    }
    rerender()
  }, [remember, rerender])

  const vat = useCallback((mode) => {
    const s = calc.current
    const v = Number(s.cur) || 0
    if (mode === 'copy') { navigator.clipboard?.writeText(s.cur); rerender(); return }
    const r = mode === 'add' ? round2(v * 1.07) : round2(v / 1.07)
    remember(plain(v) + (mode === 'add' ? '+VAT7%' : '−VAT7%'), r)
    s.cur = String(r); s.acc = null; s.op = null; s.fresh = true
    rerender()
  }, [remember, rerender])

  const applyResult = useCallback((res) => {
    Object.assign(calc.current, EMPTY, { cur: String(res) })
    rerender()
  }, [rerender])

  const drawerSide = flipDrawers ? 'right' : 'left'

  const doClose = useCallback(() => {
    setClosing(true)
    setTimeout(() => { setClosing(false); setOpen(false) }, 120)
  }, [])

  // กดนอกกล่อง = พับเก็บ (ยกเว้นปักหมุด) — ใช้ capture เพื่อให้รู้ก่อนป๊อปอัปอื่นกินคลิกไป
  useEffect(() => {
    if (!open || pinned) return
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || fabRef.current?.contains(e.target)) return
      doClose()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open, pinned, doClose])

  // คีย์บอร์ด — ต้องข้ามตอนที่โฟกัสอยู่ในช่องกรอก ไม่งั้นพิมพ์เลขในฟอร์มแล้วไปเข้าเครื่องคิดเลข
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      // ดูทั้ง target และช่องที่โฟกัสอยู่ — บางเหตุการณ์ target เป็น document
      // ถ้าเช็คแค่ target ตัวเลขที่พิมพ์ในฟอร์มจะไหลเข้าเครื่องคิดเลขด้วย
      const el = e.target && e.target !== document ? e.target : document.activeElement
      if (el?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key
      if (k === 'Escape') { doClose(); return }
      if (k === 'Enter' || k === '=') { press('='); e.preventDefault(); return }
      if (k === 'Backspace') { press('⌫'); e.preventDefault(); return }
      if (/^[0-9.]$/.test(k)) press(k)
      else if (k === '+') press('+')
      else if (k === '-') press('−')
      else if (k === '*') press('×')
      else if (k === '/') { press('÷'); e.preventDefault() }
      else if (k === '%') press('%')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, press, doClose])

  const s = calc.current
  const display = s.cur === 'หารด้วยศูนย์ไม่ได้' ? s.cur : money(s.cur) + (s.cur.endsWith('.') ? '.' : '')

  const togglePin = () => {
    setPinned((v) => { store.set('pinned', !v); return !v })
  }
  const toggleHist = () => {
    setHistOpen((v) => {
      const on = !v
      store.set('histOpen', on)
      if (on && narrow) { setNotesOpen(false); store.set('notesOpen', false) }
      return on
    })
  }
  const toggleNotes = () => {
    setNotesOpen((v) => {
      const on = !v
      store.set('notesOpen', on)
      if (on && narrow) { setHistOpen(false); store.set('histOpen', false) }
      return on
    })
  }

  return createPortal(
    <>
      {/* ── วงกลมลอย ─────────────────────────────────────────── */}
      <button
        ref={fabRef}
        type="button"
        title="เครื่องคิดเลข — กดเพื่อเปิด กดค้างเพื่อลาก"
        aria-label="เครื่องคิดเลข"
        {...fabDrag.current}
        className={`fixed z-[75] w-14 h-14 rounded-full bg-ink text-lime grid place-items-center touch-none
          shadow-[0_8px_22px_rgba(22,24,29,.28)] transition-[transform,box-shadow,opacity] duration-150
          [&.is-lifted]:scale-110 [&.is-lifted]:shadow-[0_14px_34px_rgba(22,24,29,.4),0_0_0_6px_rgba(199,242,80,.35)]
          ${open ? 'opacity-0 scale-50 pointer-events-none' : 'opacity-100'}`}
      >
        <UiIcon name="numpad" tone="w" size={24} />
        {pinned && (
          <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-lime border-2 border-ink" />
        )}
      </button>

      {/* ── กล่องเครื่องคิดเลข ────────────────────────────────── */}
      {open && (
        <div
          ref={panelRef}
          className={`fixed z-[80] w-[268px] max-w-[calc(100vw-24px)] touch-none ${
            closing ? 'animate-[calcOut_.12s_ease-in_forwards]' : 'animate-[calcIn_.17s_cubic-bezier(.2,.9,.3,1)]'
          }`}
        >
          {/* แถบประวัติ — ซ่อนอยู่ใต้กล่องแล้วเลื่อนออกมา */}
          <Drawer
            open={histOpen}
            side={drawerSide}
            overlay={narrow}
            depth={0}
            title="ประวัติการคำนวณ"
            action={(
              <button
                type="button"
                onClick={() => { setHistory([]); store.set('history', []) }}
                className="text-[10.5px] font-semibold text-faint hover:text-expense hover:bg-ink/[0.07] rounded-[7px] px-1.5 py-1"
                title="ล้างประวัติทั้งหมด"
              >
                ล้าง
              </button>
            )}
          >
            <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-1.5">
              {history.length === 0 ? (
                <p className="text-[11px] text-faint text-center leading-[1.7] px-2 py-4">
                  ยังไม่มีประวัติ<br />กด = แล้วโจทย์กับผลลัพธ์จะมาอยู่ตรงนี้
                </p>
              ) : history.map((h, i) => (
                <div key={i} className="border border-hairline rounded-[11px] px-2 pt-1.5 pb-[7px] bg-white">
                  <div className="text-[11px] text-faint tabular-nums truncate" title={h.expr}>{h.expr}</div>
                  {/* บรรทัดผลลัพธ์กดได้ — ดึงตัวเลขกลับเข้าเครื่องคิดเลข */}
                  <button
                    type="button"
                    onClick={() => applyResult(h.res)}
                    title={`กดเพื่อใส่ ${money(h.res)} กลับเข้าเครื่องคิดเลข`}
                    className="w-full mt-0.5 text-right text-[15px] font-bold tabular-nums rounded-[7px] px-1 py-0.5 hover:bg-[#F2FAD9]"
                  >
                    {money(h.res)}
                  </button>
                </div>
              ))}
            </div>
          </Drawer>

          {/* แถบโน๊ต — สมุดจดเปล่าๆ หนึ่งแผ่น พิมพ์อะไรก็ได้ ไม่มีโครงสร้างให้กรอก
              เพราะหน้าที่ของมันคือ "จด" อย่างเดียว ตัวเลขที่คิดเสร็จแล้วมีประวัติเก็บให้อยู่แล้ว
              เปิดพร้อมประวัติได้ โน๊ตจะไปกางถัดจากประวัติอีกชั้น */}
          <Drawer
            open={notesOpen}
            side={drawerSide}
            overlay={narrow}
            depth={histOpen ? 1 : 0}
            title="โน๊ต"
            action={note.trim() !== '' && (
              <button
                type="button"
                onClick={() => { setNote(''); store.set('note', '') }}
                className="text-[10.5px] font-semibold text-faint hover:text-expense hover:bg-ink/[0.07] rounded-[7px] px-1.5 py-1"
                title="ล้างโน๊ตทั้งแผ่น"
              >
                ล้าง
              </button>
            )}
          >
            <textarea
              value={note}
              onChange={(e) => { setNote(e.target.value); store.set('note', e.target.value) }}
              placeholder="จดอะไรก็ได้ที่นี่&#10;เช่น ยอดจากบิล เลขที่ต้องจำ&#10;บันทึกให้อัตโนมัติ"
              spellCheck={false}
              className="flex-1 w-full resize-none border-0 outline-none bg-white px-3 py-2.5 text-[12.5px] leading-[1.7] text-ink placeholder:text-faint placeholder:leading-[1.9]"
            />
          </Drawer>

          {/* ตัวกล่องขาว */}
          {/* ปักหมุดอยู่ = ขอบมะนาวรอบกล่อง เห็นแต่ไกลว่าทำไมกดนอกกล่องแล้วไม่พับ
              (ปุ่มติดไฟอย่างเดียวเล็กเกินกว่าจะสังเกตเห็นตอนกำลังทำอย่างอื่น) */}
          <div className={`relative z-[1] bg-white rounded-[18px] border overflow-hidden shadow-[0_18px_60px_rgba(22,24,29,.34)] ${
            pinned ? 'border-lime ring-2 ring-lime/60' : 'border-hairline'
          }`}>
            <div
              {...barDrag.current}
              className="h-[42px] flex items-center gap-2 pl-3 pr-2 bg-[#FAF9F6] border-b border-[#EFEDE7] cursor-grab select-none [&.is-lifted]:cursor-grabbing [&.is-lifted]:bg-[#F2FAD9]"
            >
              <svg className="w-3.5 h-3.5 flex-none text-[#B9B6AD]" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <circle cx="4" cy="4" r="1.4" /><circle cx="4" cy="8" r="1.4" /><circle cx="4" cy="12" r="1.4" />
                <circle cx="9" cy="4" r="1.4" /><circle cx="9" cy="8" r="1.4" /><circle cx="9" cy="12" r="1.4" />
              </svg>
              <span className="flex-1 min-w-0 leading-tight">
                <span className="block text-[12.5px] font-semibold">เครื่องคิดเลข</span>
                <span className="block text-[10px] text-faint">
                  {pinned ? 'ปักหมุดไว้ · กดนอกกล่องไม่พับ' : 'กดนอกกล่องเพื่อพับเก็บ'}
                </span>
              </span>
              <button
                type="button"
                onClick={toggleNotes}
                title="โน๊ต — จดอะไรก็ได้ บันทึกให้อัตโนมัติ"
                className={`w-7 h-7 flex-none rounded-lg grid place-items-center ${
                  notesOpen ? 'bg-lime text-ink' : 'text-faint hover:bg-ink/[0.07] hover:text-ink'
                }`}
              >
                <UiIcon name="note" tone={notesOpen ? undefined : 'gray'} size={16} />
              </button>
              <button
                type="button"
                onClick={toggleHist}
                title="ประวัติการคำนวณ"
                className={`w-7 h-7 flex-none rounded-lg grid place-items-center ${
                  histOpen ? 'bg-lime text-ink' : 'text-faint hover:bg-ink/[0.07] hover:text-ink'
                }`}
              >
                <Icon name="history" size={17} />
              </button>
              <button
                type="button"
                onClick={togglePin}
                title={pinned ? 'เลิกปักหมุด' : 'ปักหมุดให้เปิดค้างไว้'}
                className={`w-7 h-7 flex-none rounded-lg grid place-items-center ${
                  pinned ? 'bg-lime text-ink' : 'text-faint hover:bg-ink/[0.07] hover:text-ink'
                }`}
              >
                <UiIcon name="pin" tone={pinned ? undefined : 'gray'} size={16} />
              </button>
              <button
                type="button"
                onClick={doClose}
                title="พับเก็บ"
                className="w-7 h-7 flex-none rounded-lg grid place-items-center text-faint hover:bg-ink/[0.07] hover:text-ink"
              >
                <Icon name="close" size={18} />
              </button>
            </div>

            <div className="px-3.5 pt-2.5 pb-2 text-right">
              <div className="min-h-4 text-[11.5px] text-faint tabular-nums">
                {s.acc == null ? ' ' : `${money(s.acc)} ${s.op ?? ''}`}
              </div>
              <div className="text-[28px] font-bold leading-[1.15] tabular-nums break-all">{display}</div>
            </div>

            <div className="flex gap-1.5 px-3 pb-2">
              {[['add', '+ VAT 7%'], ['ex', 'ถอด VAT'], ['copy', 'คัดลอก']].map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => vat(m)}
                  className="flex-1 h-7 rounded-[9px] border border-hairline bg-white text-[11px] font-semibold text-muted hover:bg-paper hover:text-ink"
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-4 gap-1.5 px-3 pb-3">
              {PAD.map(({ k, cls, wide }) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => press(k)}
                  className={`${KEY_BASE} ${KEY_CLASS[cls ?? 'num']} ${wide ? 'col-span-2' : ''}`}
                >
                  {k}
                </button>
              ))}
            </div>

            <div className="px-3 pt-[7px] pb-2.5 border-t border-[#EFEDE7] bg-[#FAF9F6] text-[10.5px] text-faint flex items-center gap-1.5">
              <Icon name="check" size={13} />
              คีย์บอร์ดพิมพ์ได้ · <b className="text-income font-semibold">Enter</b> เท่ากับ ·{' '}
              <b className="text-income font-semibold">Esc</b> พับเก็บ
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  )
}
