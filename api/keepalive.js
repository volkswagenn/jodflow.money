/**
 * ping Supabase วันละครั้ง กันโปรเจกต์ FREE plan หลับ — Vercel Cron เรียก (ดู vercel.json)
 *
 * แพ็กเกจฟรีหยุดโปรเจกต์ที่ไม่มีการใช้งานราว 7 วัน พอหยุดแล้วแอปเข้าไม่ได้ทั้งระบบ
 * (หน้า login ขึ้น "ต่ออินเทอร์เน็ตไม่ได้") จนกว่าจะเข้าแดชบอร์ดไปกด Resume เอง
 * ฟังก์ชันนี้ทำให้มีการใช้งานทุกวันแม้ไม่มีใครเปิดแอป
 *
 * เรียก keepalive() ใน supabase/keepalive.sql ซึ่ง "เขียน" ลงฐานจริงหนึ่งแถว
 * (อ่านอย่างเดียวอาจไม่ถูกนับเป็นการใช้งาน) ต้องรันไฟล์นั้นก่อน ไม่งั้นได้ 404
 *
 * ใช้ URL กับ publishable key ตัวเดียวกับหน้าเว็บ — ค่าสาธารณะโดยตั้งใจ
 * (ห้ามเปลี่ยนเป็น service_role / secret key เด็ดขาด)
 * เปิด URL นี้ตรงๆ ในเบราว์เซอร์ก็ได้ ใช้เช็คว่าทำงานไหม ผลเสียมีแค่ตัวนับเพิ่มหนึ่ง
 */
export default async function handler(req, res) {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) {
    return res.status(500).json({ ok: false, error: 'ไม่มี VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ใน Environment Variables ของ Vercel' })
  }

  // ลอง 3 ครั้ง — เน็ตสะดุดหรือโปรเจกต์เพิ่งตื่น ไม่ควรนับว่าล้ม
  let last = null
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${url}/rest/v1/rpc/keepalive`, {
        method: 'POST',
        headers: { apikey: key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_source: req.headers['user-agent']?.includes('vercel-cron') ? 'vercel-cron' : 'manual' }),
      })
      const body = await r.text()
      if (r.ok) return res.status(200).json({ ok: true, result: JSON.parse(body) })
      last = { status: r.status, body: body.slice(0, 300) }
    } catch (e) {
      last = { error: String(e?.message ?? e) }
    }
    await new Promise((s) => setTimeout(s, 3000))
  }
  // 500 = ขึ้นเป็นงานล้มใน Vercel → Logs ไว้ไล่ดู (เช่น โปรเจกต์ถูกหยุดไปแล้ว / ยังไม่รัน keepalive.sql)
  return res.status(500).json({ ok: false, last })
}
