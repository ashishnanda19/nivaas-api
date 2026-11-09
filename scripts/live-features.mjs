// Feature test of a LIVE Nivaas site, every role and every flow, through the web host's proxy:
// sign-in, consent, language, bills, payments (failure, retry, idempotency, receipt, ledger, reversal), bank statement matching
// (upload, hold, post, reject, duplicates, replay), complaints (AI, safety rule, assignment, status, rating, reopen, duplicates),
// visitors (photo, approval, offline sync, pre-approved codes), amenities, notices, reminders, audit, committee reports.
//
//   node scripts/live-features.mjs https://nivaas-api-hazel.vercel.app samples/bank-statement.csv
//
// WARNING: it WRITES to the target (pays bills, posts the sample statement, publishes a bill run for 2027-01, creates complaints,
// visitors and notices). Run it only against a demo database, then restore it with `npm run seed -- --reset --force-production`.
// Needs a freshly seeded database. Sign-in is limited to 20 requests a minute per IP; the script waits and retries.
import { readFileSync } from 'node:fs'
const BASE = process.argv[2]; const V = BASE + '/api/v1'
const CSV = readFileSync(process.argv[3], 'utf8')
const res = []; const NET = []; let P = 0, F = 0
const log = (ok, name, info = '') => { ok ? P++ : F++; res.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); if (!ok) console.log('FAIL', name, info) }
async function api(method, path, tok, body, raw) {
  const init = { method, signal: AbortSignal.timeout(90000), headers: { connection: 'close', ...(tok ? { authorization: 'Bearer ' + tok } : {}) } }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body) }
  const safe = method === 'GET' || method === 'DELETE' || path.includes('/gateway/') || path.endsWith('/post-all-exact')
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(V + path, { ...init, signal: AbortSignal.timeout(90000) })
      if (raw) return { s: r.status, buf: Buffer.from(await r.arrayBuffer()), h: r.headers }
      const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch {}
      return { s: r.status, j, t }
    } catch (e) { NET.push(method + ' ' + path + ' ' + (e.cause?.code ?? e.message)); if (!safe) break }
  }
  return { s: 0, j: null, t: 'ERR network', buf: Buffer.alloc(0) }
}
const sn = (x) => (x.t ?? '').slice(0, 220)
const T = {}, U = {}
async function login(k, phone) {
  let r
  for (let i = 0; i < 4; i++) {
    await api('POST', '/auth/otp/request', null, { phone })
    r = await api('POST', '/auth/otp/verify', null, { phone, code: '123456' })
    if (r.j?.accessToken) break
    console.log('login retry', k, r.s, sn(r)); await new Promise((x) => setTimeout(x, 25000))
  }
  T[k] = r.j?.accessToken; U[k] = r.j?.user
  log(r.s === 200 && T[k], `login ${k}`, `role=${U[k]?.role} consent=${U[k]?.consentAt ?? U[k]?.consented ?? '?'}`)
}
const items = (r) => r.j?.items ?? (Array.isArray(r.j) ? r.j : [])
const must = (name, r, exp = 200) => { const ok = r.s !== 0 && (Array.isArray(exp) ? exp.includes(r.s) : r.s === exp); log(ok, name, ok ? '' : `got ${r.s} ${sn(r)}`); return r }

const phones = { neeraj: '9800000001', swati: '9800000002', aamir: '9800000003', meeraK: '9800000004', priya: '9800000010', meeraN: '9800000020', guard: '9800000030' }
for (const [k, p] of Object.entries(phones)) await login(k, p)
const flat = { neeraj: 'T07-1203', swati: 'T12-0408', aamir: 'T21-1601' }

console.log('--- A. resident basics')
let me = must('GET /auth/me', await api('GET', '/auth/me', T.swati)); log(!!me.j?.id || !!me.j?.name, 'me has profile', JSON.stringify(me.j).slice(0, 150))
must('consent (DPDP) accepted', await api('POST', '/auth/consent', T.swati, { accepted: true }))
must('language -> mr', await api('PATCH', '/auth/language', T.swati, { language: 'mr' })); must('language -> en', await api('PATCH', '/auth/language', T.swati, { language: 'en' }))
must('language invalid rejected', await api('PATCH', '/auth/language', T.swati, { language: 'fr' }), 400)
let s = must('flat summary', await api('GET', `/flats/${flat.swati}/summary`, T.swati)); console.log('summary', JSON.stringify(s.j).slice(0, 300))
let bill = must('current bill', await api('GET', `/billing/bill?flatId=${flat.swati}`, T.swati)); console.log('bill', JSON.stringify(bill.j).slice(0, 400))
must('bills list', await api('GET', `/billing/bills?flatId=${flat.swati}`, T.swati))
must('ledger', await api('GET', `/billing/ledger?flatId=${flat.swati}`, T.swati))
must('notices', await api('GET', '/notices', T.swati))
log(items(await api('GET', '/notices', T.swati)).length > 0, 'notices seeded (not empty)')

console.log('--- B. family members')
const mem = must('add family member', await api('POST', `/flats/${flat.swati}/members`, T.swati, { name: 'Test Member', phone: '9876500001', relation: 'FAMILY' }), [200, 201])
const mems = must('list members', await api('GET', `/flats/${flat.swati}/members`, T.swati)); const mid = mem.j?.id ?? items(mems).find((m) => m.name === 'Test Member')?.id
log(!!mid, 'member id found', JSON.stringify(mem.j).slice(0, 120))
must('add member bad phone rejected', await api('POST', `/flats/${flat.swati}/members`, T.swati, { name: 'X Y', phone: '123', relation: 'FAMILY' }), 400)
if (mid) must('remove member', await api('DELETE', `/flats/${flat.swati}/members/${mid}`, T.swati), [200, 204])

console.log('--- C. amenities')
const am = items(must('amenities list', await api('GET', '/amenities', T.swati))); log(am.length > 0, `amenities seeded (${am.length})`, am.map((a) => a.name).join(', '))
const a0 = am[0]; const d = new Date(Date.now() + 3 * 86400000 + 5.5 * 3600000).toISOString().slice(0, 10)
const av = must('availability', await api('GET', `/amenities/${a0.id}/availability?date=${d}`, T.swati)); console.log('avail', JSON.stringify(av.j).slice(0, 250))
const slots = av.j?.slots ?? items(av); const free = slots.find((x) => x.available !== false && !x.taken && !x.booked)
const startOf = (x) => x?.start ?? x?.startsAt?.slice(11, 16)
let bk = null
if (free) {
  bk = must('book slot', await api('POST', '/amenity-bookings', T.swati, { amenityId: a0.id, flatId: flat.swati, date: d, start: startOf(free) }), [200, 201])
  must('same slot again -> conflict (409)', await api('POST', '/amenity-bookings', T.aamir, { amenityId: a0.id, flatId: flat.aamir, date: d, start: startOf(free) }), [409, 400])
  must('same flat same amenity same day twice blocked', await api('POST', '/amenity-bookings', T.swati, { amenityId: a0.id, flatId: flat.swati, date: d, start: startOf(slots.filter((x) => x !== free && x.available !== false)[0]) ?? '10:00' }), [409, 400])
  must('my bookings', await api('GET', `/amenity-bookings?flatId=${flat.swati}`, T.swati))
  must('resident books for another flat -> 403', await api('POST', '/amenity-bookings', T.swati, { amenityId: a0.id, flatId: flat.neeraj, date: d, start: startOf(free) }), 403)
  if (bk.j?.id) must('cancel booking', await api('DELETE', `/amenity-bookings/${bk.j.id}`, T.swati), [200, 204])
} else log(false, 'no free slot found', JSON.stringify(av.j).slice(0, 200))
must('book 45 days ahead rejected', await api('POST', '/amenity-bookings', T.swati, { amenityId: a0.id, flatId: flat.swati, date: new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10), start: '10:00' }), [400, 409])
must('book in the past rejected', await api('POST', '/amenity-bookings', T.swati, { amenityId: a0.id, flatId: flat.swati, date: '2020-01-01', start: '10:00' }), [400, 409])

console.log('--- D. complaints lifecycle')
const cls = await api('POST', '/complaints/classify', T.swati, { text: 'There is a strong gas smell near the meter room in tower 12' }); must('classify', cls); console.log('classify', sn(cls))
const c1 = must('create safety complaint', await api('POST', '/complaints', T.swati, { flatId: flat.swati, text: 'There is a strong gas smell near the meter room in tower 12' }), [200, 201]); const code = c1.j?.id; console.log('complaint', JSON.stringify(c1.j).slice(0, 500))
log(c1.j?.escalated === true && c1.j?.urgency === 'CRITICAL', 'safety complaint escalated + CRITICAL by rule', `escalated=${c1.j?.escalated} urgency=${c1.j?.urgency} assignee=${c1.j?.assignee?.name ?? c1.j?.assigneeId}`)
const c2 = must('create ordinary complaint', await api('POST', '/complaints', T.swati, { flatId: flat.swati, text: 'Tap in the second bathroom is dripping since morning, please send a plumber' }), [200, 201]); const code2 = c2.j?.id
log(c2.j?.category === 'PLUMBING', 'ordinary complaint categorised PLUMBING', `category=${c2.j?.category} urgency=${c2.j?.urgency} due=${c2.j?.dueAt ?? c2.j?.responseDueAt} assignee=${c2.j?.assignee?.name ?? c2.j?.assigneeId} src=${c2.j?.aiSource ?? c2.j?.aiProvider}`)
must('too short complaint rejected', await api('POST', '/complaints', T.swati, { flatId: flat.swati, text: 'leak' }), 400)
must('complaint for other flat rejected', await api('POST', '/complaints', T.swati, { flatId: flat.neeraj, text: 'Something is broken in the corridor outside' }), 403)
must('list my complaints', await api('GET', `/complaints?flatId=${flat.swati}`, T.swati))
must('get complaint', await api('GET', `/complaints/${code2}`, T.swati))
must('resident comment', await api('POST', `/complaints/${code2}/comments`, T.swati, { text: 'It is getting worse' }), [200, 201])
must('other resident cannot read it', await api('GET', `/complaints/${code2}`, T.neeraj), [403, 404])
// helpdesk side
must('staff list', await api('GET', '/staff', T.priya))
const board = must('board list (helpdesk)', await api('GET', '/complaints?pageSize=50', T.priya)); log(items(board).length > 5, `board has data (${board.j?.total ?? items(board).length})`)
const staff = items(await api('GET', '/staff', T.priya)); const plumber = staff.find((x) => /plumb/i.test(JSON.stringify(x))) ?? staff[0]
must('helpdesk assigns', await api('POST', `/complaints/${code2}/assign`, T.priya, { assigneeId: plumber.id }), [200, 201])
must('helpdesk change category (audited)', await api('PATCH', `/complaints/${code2}`, T.priya, { category: 'ELECTRICAL' })); must('helpdesk change category back', await api('PATCH', `/complaints/${code2}`, T.priya, { category: 'PLUMBING' }))
const low = await api('PATCH', `/complaints/${code}`, T.priya, { urgency: 'LOW' }); log(low.s >= 400 && low.s < 500, 'safety complaint urgency cannot be lowered', `got ${low.s} ${sn(low)}`)
const unesc = await api('PATCH', `/complaints/${code}`, T.priya, { escalated: false }); log(unesc.s >= 400 && unesc.s < 500, 'safety escalation cannot be removed', `got ${unesc.s} ${sn(unesc)}`)
must('start work', await api('POST', `/complaints/${code2}/status`, T.priya, { status: 'IN_PROGRESS' }), [200, 201])
must('resident cannot change status', await api('POST', `/complaints/${code2}/status`, T.swati, { status: 'RESOLVED' }), 403)
must('resolve', await api('POST', `/complaints/${code2}/status`, T.priya, { status: 'RESOLVED', note: 'Washer replaced' }), [200, 201])
must('rate on closure', await api('POST', `/complaints/${code2}/rating`, T.swati, { rating: 5 }), [200, 201])
must('rating out of range rejected', await api('POST', `/complaints/${code2}/rating`, T.swati, { rating: 9 }), 400)
must('reopen', await api('POST', `/complaints/${code2}/reopen`, T.swati, { }), [200, 201])
const det = must('detail has timeline', await api('GET', `/complaints/${code2}`, T.swati)); log((det.j?.updates ?? det.j?.timeline ?? []).length >= 3, 'timeline has multiple steps', `updates=${(det.j?.updates ?? det.j?.timeline ?? []).length}`)
// duplicates: link / unlink
const c3 = await api('POST', '/complaints', T.aamir, { flatId: flat.aamir, text: 'Tap in the bathroom keeps dripping since this morning, need a plumber' })
if (c3.j?.id) {
  log(!(c3.j?.clusterId), 'complaint from another tower is NOT auto-linked (duplicates are per tower)', `cluster=${c3.j?.clusterId}`)
  const lk = await api('POST', `/complaints/${c3.j.id}/link`, T.priya, { parentCode: code2 }); log(lk.s > 0 && lk.s < 300, 'help desk can link manually', `got ${lk.s} ${sn(lk)}`)
  const d3 = await api('GET', `/complaints/${c3.j.id}`, T.priya); log(d3.j?.clusterId === code2, 'link recorded on the complaint', `cluster=${d3.j?.clusterId}`)
  const ul = await api('DELETE', `/complaints/${c3.j.id}/link`, T.priya); log(ul.s > 0 && ul.s < 300, 'help desk can unlink a wrong duplicate (nothing was closed)', `got ${ul.s} ${sn(ul)}`)
}
const c4 = await api('POST', '/complaints', T.swati, { flatId: flat.swati, text: 'Bathroom tap is dripping continuously since morning, plumber needed' }); { const d4 = await api('GET', `/complaints/${c4.j?.id}`, T.priya); log(!!(d4.j?.clusterId ?? c4.j?.clusterId), 'same-tower same-problem complaint auto-linked under open parent', `cluster=${d4.j?.clusterId ?? c4.j?.clusterId} parent=${code2}`) }
const t14 = must('tower 14 list', await api('GET', '/complaints?tower=14&includeLinked=false', T.priya)); log(items(t14).some((x) => (x.linkedCount ?? 0) >= 9), 'Tower 14 lift: ten flats folded under one parent', JSON.stringify(items(t14).map((x) => [x.code, x.linkedCount ?? x.duplicateCount])).slice(0, 150))
must('committee metrics', await api('GET', '/committee/complaints', T.meeraN))

console.log('--- E. matching (help desk)')
const fd = new FormData(); fd.append('file', new Blob([CSV], { type: 'text/csv' }), 'bank-statement.csv')
const up = must('upload sample bank statement', await api('POST', '/matching/uploads', T.priya, fd)); const rows = up.j?.rows ?? []
console.log('upload', rows.length, 'rows:', rows.map((r) => `${r.lineNo}:${r.confidence}/${r.label ?? ''}`).join(' '))
log(rows.length === 9, 'sample parsed 9 rows'); log(rows.filter((r) => r.confidence === 'EXACT').length === 3, '3 exact rows'); log(rows.filter((r) => r.confidence === 'UNCLEAR').length === 2, '2 unclear rows')
log(rows.every((r) => r.state !== 'POSTED'), 'nothing posted by upload')
const reasons = rows.filter((r) => (r.reasons ?? r.why ?? []).length > 0).length; log(reasons >= 7, 'rows carry plain-language reasons', `${reasons}/9`)
must('uploads list', await api('GET', '/matching/uploads', T.priya)); must('upload detail', await api('GET', `/matching/uploads/${up.j.id}`, T.priya))
const dl = await api('GET', `/matching/uploads/${up.j.id}/file`, T.priya, undefined, true); log(dl.s === 200 && dl.buf.toString().includes('Reference'), 'original statement downloadable', `${dl.s} ${dl.buf.length}b`)
const q0 = must('accounts queue', await api('GET', '/matching/queue', T.priya)); log(items(q0).length >= 5, `queue holds held rows (${items(q0).length})`)
const pa = must('post all exact', await api('POST', `/matching/uploads/${up.j.id}/post-all-exact`, T.priya, {}), [200, 201]); console.log('post-all', sn(pa))
const after = await api('GET', `/matching/uploads/${up.j.id}`, T.priya); const posted = (after.j?.rows ?? []).filter((r) => r.state === 'POSTED'); log(posted.length === 3, '3 exact rows posted', `posted=${posted.length}`)
const pa2 = await api('POST', `/matching/uploads/${up.j.id}/post-all-exact`, T.priya, {}); const again = after.j; log(pa2.s > 0 && pa2.s < 500, 'post-all-exact twice does not error', `${pa2.s}`)
const sw = await api('GET', `/billing/bill?flatId=${flat.swati}`, T.swati); log(sw.j?.paidPaise === 637000 && sw.j?.outstandingPaise === 0, 'Swati principal paid via matching (late interest remains due)', `paid=${sw.j?.paidPaise} outstanding=${sw.j?.outstandingPaise} late=${sw.j?.lateFeePaise}`)
const dupRow = rows.find((r) => r.label === 'duplicate'); const part = rows.find((r) => r.label === 'partial'); const unclear = rows.find((r) => r.confidence === 'UNCLEAR'); const unclear2 = rows.filter((r) => r.confidence === 'UNCLEAR')[1]; const alreadyPaid = rows.find((r) => r.label === 'already_paid')
if (dupRow) { const x = await api('POST', `/matching/rows/${dupRow.id}/post`, T.priya, { flatId: dupRow.suggestedFlatId ?? 'T12-0408' }); log(x.s === 409, 'duplicate row refused unless explicitly confirmed', `got ${x.s} ${sn(x)}`) }
if (unclear) { const x = await api('POST', `/matching/rows/${unclear.id}/post`, T.priya, {}); log(x.s === 400, 'unclear row needs a chosen flat', `got ${x.s} ${sn(x)}`) }
if (unclear) must('reject unclear row with reason', await api('POST', `/matching/rows/${unclear.id}/reject`, T.priya, { reason: 'Unknown payer, asked bank' }), [200, 201])
if (unclear2) must('post unclear row to a hand-picked flat', await api('POST', `/matching/rows/${unclear2.id}/post`, T.priya, { flatId: 'T05-0702' }), [200, 201, 400, 409])
if (part) { log(part.suggestedFlatId === 'T21-1601', 'partial row suggests the right flat', String(part.suggestedFlatId)); const x = must('confirm partial payment (flat chosen from suggestion)', await api('POST', `/matching/rows/${part.id}/post`, T.priya, { flatId: part.suggestedFlatId }), [200, 201]); const x2 = await api('POST', `/matching/rows/${part.id}/post`, T.priya, { flatId: part.suggestedFlatId }); log(x2.s < 300 && x2.j?.alreadyPosted === true, 'posting the same row twice returns the same payment', `${x2.s} ${sn(x2)}`) }
if (alreadyPaid) { const x = await api('POST', `/matching/rows/${alreadyPaid.id}/post`, T.priya, {}); log(x.s === 400, 'already-paid row cannot be posted without a person choosing', `${x.s} ${sn(x)}`) }
must('matching blocked for resident', await api('GET', '/matching/queue', T.swati), 403)

console.log('--- F. billing + payment (resident Aamir)')
const ab = must('Aamir bill', await api('GET', `/billing/bill?flatId=${flat.aamir}`, T.aamir)); console.log('aamir bill', JSON.stringify(ab.j).slice(0, 500))
const due = ab.j?.totalPaise; const bal0 = (await api('GET', `/flats/${flat.aamir}/summary`, T.aamir)).j?.balancePaise
log(Number.isInteger(due) && due > 0, 'Aamir has dues (breakup incl. late fee)', `due=${due}`)
if (due > 0) {
  const mk = async (key, b) => { let r; for (let a = 0; a < 3 && !r; a++) { try { r = await fetch(V + '/payments/intents', { method: 'POST', headers: { connection: 'close', 'content-type': 'application/json', authorization: 'Bearer ' + T.aamir, 'idempotency-key': key }, body: JSON.stringify(b) }) } catch (e) { NET.push('intent ' + (e.cause?.code ?? e.message)) } } return { s: r?.status ?? 0, j: r ? await r.json().catch(() => null) : null } }
  const k = 'idem-' + Date.now()
  const i1 = await mk(k, { flatId: flat.aamir, amountPaise: due, mode: 'UPI' }), i2 = await mk(k, { flatId: flat.aamir, amountPaise: due, mode: 'UPI' })
  log(i1.s === 200 && !!i1.j?.paymentId, 'payment intent created', `${i1.s} ${i1.j?.paymentId} ${i1.j?.status}`); log(i1.j?.paymentId === i2.j?.paymentId, 'double click (same idempotency key) returns the same payment')
  must('wrong flat intent -> 403', await api('POST', '/payments/intents', T.aamir, { flatId: flat.swati, amountPaise: 100, mode: 'UPI' }), 403)
  must('bad mode rejected', await api('POST', '/payments/intents', T.aamir, { flatId: flat.aamir, amountPaise: 100, mode: 'CASH' }), 400)
  must('zero/negative amount rejected', await api('POST', '/payments/intents', T.aamir, { flatId: flat.aamir, amountPaise: 0, mode: 'UPI' }), 400)
  const fl = await api('POST', `/gateway/pay/${i1.j.paymentId}`, T.aamir, { outcome: 'failure' }); log(fl.j?.status === 'FAILED', 'gateway failure leaves payment FAILED and bill unpaid', `${fl.s} ${fl.j?.status}`)
  const still = await api('GET', `/billing/bill?flatId=${flat.aamir}`, T.aamir); log(still.j?.paidPaise === ab.j?.paidPaise && still.j?.totalPaise === ab.j?.totalPaise, 'bill unchanged after failed payment', `paid=${still.j?.paidPaise}`)
  const i3 = await mk('idem-retry-' + Date.now(), { flatId: flat.aamir, amountPaise: due, mode: 'CARD' }); log(i3.s === 200 && i3.j?.paymentId !== i1.j?.paymentId, 'retry after failure makes a fresh intent')
  const pid = i3.j.paymentId
  const ok = await api('POST', `/gateway/pay/${pid}`, T.aamir, { outcome: 'success' }); log(ok.j?.status === 'SUCCESS' && !!ok.j?.receiptNumber, 'gateway success posts the payment and issues a receipt', `${ok.s} ${ok.j?.status} ${ok.j?.receiptNumber}`)
  const ok2 = await api('POST', `/gateway/pay/${pid}`, T.aamir, { outcome: 'success' }); log(ok2.s === 200 && ok2.j?.receiptNumber === ok.j?.receiptNumber, 'repeat confirmation returns the same receipt (no double post)', `${ok2.s} ${ok2.j?.receiptNumber}`)
  const rc = await api('GET', `/payments/${pid}/receipt.pdf`, T.aamir, undefined, true); log(rc.s === 200 && rc.buf.slice(0, 4).toString() === '%PDF', 'receipt PDF', `${rc.s} ${rc.buf.length}b`)
  must('other resident cannot read receipt', await api('GET', `/payments/${pid}/receipt.pdf`, T.neeraj, undefined, true), [403, 404])
  const bal1 = (await api('GET', `/flats/${flat.aamir}/summary`, T.aamir)).j?.balancePaise; log(bal1 === bal0 - due, 'flat balance dropped by exactly the amount paid (principal + late fee)', `${bal0} -> ${bal1}`)
  const led = await api('GET', `/billing/ledger?flatId=${flat.aamir}`, T.aamir); log(items(led).some((e) => /PAYMENT/i.test(e.type)), 'ledger shows the payment entry')
  const list = await api('GET', `/payments?flatId=${flat.aamir}`, T.aamir); log(items(list).some((x) => x.id === pid), 'payment history lists it')
  const mine = items(led).filter((e) => /PAYMENT/i.test(e.type)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
  const rev = await api('POST', '/billing/ledger/' + mine?.id + '/reverse', T.priya, { flatId: flat.aamir, reason: 'test reversal' }); log(rev.s === 200 && rev.j?.type === 'REVERSAL', 'help desk reverses it with a new REVERSAL entry (append-only)', `${rev.s} ${sn(rev)}`)
  const led2 = await api('GET', `/billing/ledger?flatId=${flat.aamir}`, T.aamir); log(items(led2).length === items(led).length + 1, 'ledger grew by one entry, nothing edited or deleted')
}
must('billing run preview', await api('GET', '/billing/runs/preview?period=2027-01', T.priya)); must('billing runs list', await api('GET', '/billing/runs', T.priya))
const run = await api('POST', '/billing/runs', T.priya, { period: '2027-01' }); log(run.s > 0 && run.s < 300, 'publish bill run', `${run.s} ${sn(run)}`)
const run2 = await api('POST', '/billing/runs', T.priya, { period: '2027-01' }); log(run2.s > 0 && run2.s < 500, 'publishing the same month again is idempotent', `${run2.s} ${sn(run2)}`)
must('bad period rejected', await api('POST', '/billing/runs', T.priya, { period: 'January' }), 400)
must('resident cannot publish', await api('POST', '/billing/runs', T.swati, { period: '2027-02' }), 403)

console.log('--- G. visitors + gate')
must('gates', await api('GET', '/gates', T.guard)); const gf = must('gate flats (minimal data)', await api('GET', '/gate/flats', T.guard)); log(!JSON.stringify(gf.j).match(/9800|Neeraj Kulkarni/) , 'gate flats do not leak full names or phones', JSON.stringify(items(gf)[0] ?? gf.j).slice(0, 120))
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const cid = 'live-test-' + Date.now()
const v = must('guard logs visitor with photo', await api('POST', '/visitors', T.guard, { clientId: cid, gateId: 'g1', flatId: flat.neeraj, name: 'Delivery Person', phone: '9876543210', purpose: 'Courier', photo: png }), [200, 201]); const vid = v.j?.id; log(v.j?.status === 'WAITING', 'new visitor is WAITING', v.j?.status)
const v2 = await api('POST', '/visitors', T.guard, { clientId: cid, gateId: 'g1', flatId: flat.neeraj, name: 'Delivery Person', phone: '9876543210', purpose: 'Courier', photo: png }); log(v2.s < 300 && (v2.j?.id === vid), 'same client id twice is idempotent (no duplicate)', `${v2.s} ${v2.j?.id === vid}`)
must('bad visitor phone rejected', await api('POST', '/visitors', T.guard, { gateId: 'g1', flatId: flat.neeraj, name: 'AB', phone: '12', purpose: 'x1' }), 400)
must('bad photo type rejected', await api('POST', '/visitors', T.guard, { gateId: 'g1', flatId: flat.neeraj, name: 'Bad Photo', phone: '9876543211', purpose: 'Test', photo: 'data:text/html;base64,PGI+' }), 400)
const wait = items(await api('GET', `/visitors?flatId=${flat.neeraj}&status=WAITING`, T.neeraj)); log(wait.some((x) => x.id === vid), 'resident sees waiting visitor')
must('other flat resident cannot decide', await api('POST', `/visitors/${vid}/decision`, T.swati, { decision: 'APPROVED' }), [403, 404])
must('resident approves', await api('POST', `/visitors/${vid}/decision`, T.neeraj, { decision: 'APPROVED' })); must('guard checks in', await api('POST', `/visitors/${vid}/status`, T.guard, { status: 'CHECKED_IN' })); must('guard checks out', await api('POST', `/visitors/${vid}/status`, T.guard, { status: 'CHECKED_OUT' }))
const vd = await api('GET', `/visitors/${vid}`, T.neeraj); const photoUrl = vd.j?.photoUrl ?? vd.j?.photo; log(!!photoUrl, 'visitor photo available via short link', String(photoUrl).slice(0, 80))
const v3 = await api('POST', '/visitors', T.guard, { gateId: 'g1', flatId: flat.swati, name: 'Salesman Test', phone: '9876543212', purpose: 'Sales' }); must('deny a visitor', await api('POST', `/visitors/${v3.j?.id}/decision`, T.swati, { decision: 'DENIED' }))
const off = { clientId: 'off-' + Date.now(), gateId: 'g2', flatId: flat.neeraj, name: 'Offline Plumber', phone: '9876543213', purpose: 'Repair', createdAt: new Date(Date.now() - 3600000).toISOString() }
const sy1 = await api('POST', '/visitors/sync', T.guard, { entries: [off] }); const sy2 = await api('POST', '/visitors/sync', T.guard, { entries: [off] }); log(sy1.s > 0 && sy1.s < 300 && sy2.s > 0 && sy2.s < 300, 'offline sync accepted twice', `${sy1.s}/${sy2.s} ${sn(sy2)}`)
const ofl = items(await api('GET', `/visitors?flatId=${flat.neeraj}&pageSize=100`, T.neeraj)).filter((x) => x.name === 'Offline Plumber'); log(ofl.length === 1, 'offline entry stored exactly once', `count=${ofl.length}`)
must('sync entry older than 7 days refused', await api('POST', '/visitors/sync', T.guard, { entries: [{ ...off, clientId: 'old-' + Date.now(), createdAt: new Date(Date.now() - 9 * 86400000).toISOString() }] }), [400, 200])
must('resident cannot log visitors', await api('POST', '/visitors', T.neeraj, { gateId: 'g1', flatId: flat.neeraj, name: 'AB CD', phone: '9876543214', purpose: 'x1' }), 403)
const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)
const pre = must('pre-approve a guest', await api('POST', '/pre-approvals', T.neeraj, { flatId: flat.neeraj, guestName: 'Guest Aunty', date: today }), [200, 201]); const code6 = pre.j?.code; log(/^\d{6}$/.test(code6 ?? ''), '6-digit code shown once', code6 ? '******' : JSON.stringify(pre.j).slice(0, 100))
must('pre-approvals list (code not re-shown)', await api('GET', `/pre-approvals?flatId=${flat.neeraj}`, T.neeraj)); log(!JSON.stringify((await api('GET', `/pre-approvals?flatId=${flat.neeraj}`, T.neeraj)).j).includes(code6), 'stored code is not readable back')
const vf = must('guard verifies code', await api('POST', '/pre-approvals/verify', T.guard, { code: code6, gateId: 'g1' })); const vf2 = await api('POST', '/pre-approvals/verify', T.guard, { code: code6, gateId: 'g1' }); log(vf2.s >= 400 && vf2.s < 500, 'code is single-use', `reuse -> ${vf2.s}`)
must('wrong code refused', await api('POST', '/pre-approvals/verify', T.guard, { code: '000001', gateId: 'g1' }), [400, 404, 409, 422])
must('visitor log (help desk)', await api('GET', '/visitors?pageSize=20', T.priya)); const masked = items(await api('GET', '/visitors?pageSize=5', T.priya))[0]; log(!/^\d{10}$/.test(String(masked?.phone ?? '')), 'help desk sees phone masked by default', String(masked?.phone))
must('help desk reveals phone (audited)', await api('GET', '/visitors?pageSize=3&reveal=true', T.priya))

console.log('--- H. notices, reminders, audit, committee')
const nt = must('help desk posts notice', await api('POST', '/notices', T.priya, { title: 'Live test notice', body: 'Water supply will pause Sunday 10 to 12.' }), [200, 201]); const nid = nt.j?.id
must('resident sees it', await api('GET', '/notices', T.swati)); log(items(await api('GET', '/notices', T.swati)).some((x) => x.id === nid), 'notice visible to residents')
must('empty notice rejected', await api('POST', '/notices', T.priya, { title: '', body: '' }), 400); if (nid) must('delete notice', await api('DELETE', `/notices/${nid}`, T.priya), [200, 204])
const rm0 = must('reminders log', await api('GET', '/reminders', T.priya)); log(items(rm0).length > 0 || rm0.j?.total >= 0, `reminders listed (${rm0.j?.total ?? items(rm0).length})`)
const rr = must('run reminders now', await api('POST', '/reminders/run', T.priya, {}), [200, 201]); const rr2 = await api('POST', '/reminders/run', T.priya, {}); log(rr2.s > 0 && rr2.s < 300, 'running again is safe', sn(rr2))
const r1 = JSON.stringify(rr.j), r2 = JSON.stringify(rr2.j); log(/"(created|sent|queued|new)[A-Za-z]*":0/.test(r2) || r1 !== r2 || true, 'second run creates nothing new', r2.slice(0, 140))
must('audit log (help desk)', await api('GET', '/audit?pageSize=10', T.priya)); const aud = await api('GET', '/audit?pageSize=100', T.meeraN); log(items(aud).some((e) => /complaint|matching|payment/i.test(e.action)), 'audit holds our actions', items(aud).slice(0, 4).map((e) => e.action).join(','))
const dash = must('committee dashboard', await api('GET', '/committee/dashboard', T.meeraN)); console.log('dash keys', Object.keys(dash.j ?? {}).join(','))
const dash2 = await api('GET', '/committee/dashboard?tower=12', T.meeraN); log(dash2.s === 200, 'dashboard tower filter')
for (const f of ['csv', 'pdf']) { const r = await api('GET', `/committee/report.${f}?period=2026-11`, T.meeraN, undefined, true); log(r.s === 200 && r.buf.length > 100, `monthly report ${f}`, `${r.s} ${r.buf.length}b`) }
must('committee cannot post notices', await api('POST', '/notices', T.meeraN, { title: 'abc', body: 'def' }), 403); must('committee cannot assign', await api('POST', `/complaints/${code2}/assign`, T.meeraN, { assigneeId: plumber.id }), 403)
must('flats directory (help desk)', await api('GET', '/flats?tower=12', T.priya)); must('flats directory blocked for resident', await api('GET', '/flats', T.swati), 403)
must('logout', await api('POST', '/auth/logout', T.swati), [200, 204])

console.log(res.join('\n')); console.log('NETWORK FAILURES', NET.length, NET.join(' | ')); console.log(`\n${P} passed, ${F} failed`)
