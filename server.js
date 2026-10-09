/* ============================================================
   DEN ZERO — registration backend
   Express + Postgres + local disk uploads + Razorpay payments
   ============================================================ */
require('dotenv').config({ override: true }); // .env wins over stale values pinned in pm2's saved environment

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const Razorpay = require('razorpay');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PORT = process.env.PORT || 8642;
const UPLOAD_ROOT = path.join(__dirname, 'uploads');
const TMP_DIR = path.join(UPLOAD_ROOT, 'tmp');
const DECK_DIR = path.join(UPLOAD_ROOT, 'decks');
const SHOT_DIR = path.join(UPLOAD_ROOT, 'payments'); // legacy manual-UPI screenshots
[TMP_DIR, DECK_DIR, SHOT_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));

/* Registration fee per team, by city (₹). The client only displays these;
   the Razorpay order amount always comes from here. */
const CITY_FEES = { Pune: 1499, Bangalore: 2499, Mumbai: 1999 };

/* CITY_FEE_OVERRIDES (testing only): temporary per-city fees in ₹, e.g.
   "Pune:1,Mumbai:2,Bangalore:3" to run small live payments end to end.
   Remove it from .env and restart to go back to the fees above. */
for (const pair of (process.env.CITY_FEE_OVERRIDES || '').split(',')) {
  const [city, amount] = pair.split(':').map((s) => s.trim());
  if (!city) continue;
  if (!Object.hasOwn(CITY_FEES, city) || !(Number.isInteger(+amount) && +amount > 0)) {
    console.error(`CITY_FEE_OVERRIDES: ignoring "${pair}"`);
    continue;
  }
  CITY_FEES[city] = +amount;
  console.warn(`CITY_FEE_OVERRIDES is set: ${city} is charged ₹${amount}. Remove it before launch.`);
}

/* ---------------------------------------------------------
   Razorpay — keys live only in .env; the browser gets key_id
   --------------------------------------------------------- */
const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET } = process.env;
const razorpay = RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET
  ? new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET })
  : null;
if (!razorpay) console.warn('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — registrations are disabled.');
if (!RAZORPAY_WEBHOOK_SECRET) console.warn('RAZORPAY_WEBHOOK_SECRET not set — webhooks will be rejected.');

const hmacHex = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const safeEqual = (a, b) =>
  typeof a === 'string' && typeof b === 'string' && a.length === b.length &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/* Mark a registration paid from a Razorpay payment entity — the single place
   that decides a payment counts. Idempotent: safe for verify + webhook + reconcile. */
async function settlePayment(payment) {
  const { rows } = await pool.query(
    'SELECT id, ref_id, fee, payment_status FROM registrations WHERE razorpay_order_id = $1',
    [payment.order_id]
  );
  const reg = rows[0];
  if (!reg) {
    console.error(`ORPHAN PAYMENT ${payment.id}: order ${payment.order_id} matches no registration`);
    return { ok: false, reason: 'unknown order' };
  }
  if (reg.payment_status === 'paid') return { ok: true, reg };

  if (payment.amount !== reg.fee * 100 || payment.currency !== 'INR') {
    console.error(`AMOUNT MISMATCH ${reg.ref_id}: got ${payment.amount} ${payment.currency}, expected ${reg.fee * 100} INR`);
    return { ok: false, reason: 'amount mismatch' };
  }

  if (payment.status === 'authorized') {
    // auto-capture should do this; capture ourselves if it hasn't yet
    try {
      payment = await razorpay.payments.capture(payment.id, payment.amount, 'INR');
    } catch {
      payment = await razorpay.payments.fetch(payment.id); // captured concurrently
    }
  }
  if (payment.status !== 'captured') return { ok: false, reason: `payment ${payment.status}` };

  await pool.query(
    `UPDATE registrations
        SET payment_status = 'paid', payment_verified = TRUE, razorpay_payment_id = $1,
            amount_paid = $2, paid_at = to_timestamp($3)
      WHERE id = $4 AND payment_status IS DISTINCT FROM 'paid'`,
    [payment.id, payment.amount / 100, payment.created_at, reg.id]
  );
  console.log(`paid: ${reg.ref_id} ${payment.id} ₹${payment.amount / 100}`);
  return { ok: true, reg };
}

/* ---------------------------------------------------------
   Uploads — to tmp first, renamed to the ref id after insert
   --------------------------------------------------------- */
const upload = multer({
  storage: multer.diskStorage({
    destination: TMP_DIR,
    filename: (_req, file, cb) =>
      cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = file.fieldname === 'deckFile' && file.mimetype === 'application/pdf';
    cb(ok ? null : new Error('Pitch deck must be a PDF.'), ok);
  },
}).fields([{ name: 'deckFile', maxCount: 1 }]);

const cleanupTmp = (files) =>
  Object.values(files || {})
    .flat()
    .forEach((f) => fs.unlink(f.path, () => {}));

/* register throttle: 10 per hour per IP (each one creates a Razorpay order + stores a deck) */
const regHits = new Map();
const registerThrottled = (ip) => {
  const now = Date.now();
  const hits = (regHits.get(ip) || []).filter((t) => now - t < 3600 * 1000);
  hits.push(now);
  regHits.set(ip, hits);
  return hits.length > 10;
};

/* ---------------------------------------------------------
   POST /api/register — save as awaiting_payment, create the order
   --------------------------------------------------------- */
app.post('/api/register', (req, res) => {
  const ip = req.headers['x-real-ip'] || req.socket.remoteAddress;
  if (registerThrottled(ip))
    return res.status(429).json({ error: 'Too many attempts. Please try again in an hour.' });
  if (!razorpay)
    return res.status(503).json({ error: 'Payments are not available right now. Please try again later.' });

  upload(req, res, async (uploadErr) => {
    if (uploadErr) {
      cleanupTmp(req.files);
      const msg = uploadErr.code === 'LIMIT_FILE_SIZE' ? 'Pitch deck must be under 10 MB.' : uploadErr.message;
      return res.status(400).json({ error: msg });
    }

    const b = req.body;
    const field = (k) => (typeof b[k] === 'string' ? b[k].trim() : ''); // repeated fields arrive as arrays
    const deck = req.files?.deckFile?.[0];
    let regId = null;
    let deckFile = null;

    try {
      /* ---- validate ---- */
      const city = field('city');
      const fee = Object.hasOwn(CITY_FEES, city) ? CITY_FEES[city] : null;
      if (!fee) throw badReq('Select your city (Pune, Bangalore or Mumbai).');

      const teamSize = parseInt(field('teamSize'), 10);
      if (![1, 2, 3].includes(teamSize)) throw badReq('Invalid team size.');

      const required = [
        'teamName', 'leadName', 'leadWhatsapp', 'leadEmail',
        'ideaName', 'stage', 'problem', 'solution', 'audience',
        'unique', 'progress', 'idealInvestor', 'source',
      ];
      for (const f of required) {
        if (!field(f)) throw badReq(`Missing field: ${f}`);
      }
      if (!deck) throw badReq('Pitch deck is required.');
      if (!/^\d{10}$/.test(field('leadWhatsapp')))
        throw badReq('WhatsApp number must be exactly 10 digits.');

      const today = new Date().toISOString().slice(0, 10);
      const members = [];
      for (let i = 0; i < teamSize; i++) {
        const m = {
          name: field(`m${i}-name`), college: field(`m${i}-college`),
          course: field(`m${i}-course`), email: field(`m${i}-email`),
          phone: field(`m${i}-phone`), dob: field(`m${i}-dob`),
          linkedin: field(`m${i}-linkedin`) || null,
        };
        if (!m.name || !m.college || !m.course || !m.email || !m.phone || !m.dob)
          throw badReq(`Member ${i + 1} details are incomplete.`);
        if (!/^\d{10}$/.test(m.phone))
          throw badReq(`Member ${i + 1} phone must be exactly 10 digits.`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(m.dob))
          throw badReq(`Member ${i + 1} date of birth is invalid.`);
        if (m.dob < '1995-01-01')
          throw badReq(`Member ${i + 1} must be born on or after 1 Jan 1995.`);
        if (m.dob > today)
          throw badReq(`Member ${i + 1} date of birth can't be in the future.`);
        members.push(m);
      }

      const lookingFor = [].concat(b.lookingFor || []).filter((v) => typeof v === 'string');
      if (!lookingFor.length) throw badReq('Select at least one "looking for" option.');

      /* ---- insert (awaiting payment) ---- */
      const { rows } = await pool.query(
        `INSERT INTO registrations
           (city, fee, team_name, team_size, members, lead_name, lead_whatsapp, lead_email,
            idea_name, stage, problem, solution, audience, unique_edge, progress,
            ideal_investor, source, looking_for, payment_method, payment_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'razorpay','awaiting_payment')
         RETURNING id`,
        [
          city, fee, field('teamName'), teamSize, JSON.stringify(members),
          field('leadName'), field('leadWhatsapp'), field('leadEmail'),
          field('ideaName'), field('stage'), field('problem'), field('solution'),
          field('audience'), field('unique'), field('progress'),
          field('idealInvestor'), field('source'), lookingFor,
        ]
      );
      regId = rows[0].id;
      const refId = `DZ-26-${String(1000 + regId)}`;

      /* ---- move deck into place ---- */
      const deckName = `${refId}-deck${path.extname(deck.filename)}`;
      deckFile = path.join(DECK_DIR, deckName);
      fs.renameSync(deck.path, deckFile);

      /* ---- Razorpay order: amount decided here, never by the client ---- */
      const order = await razorpay.orders.create({
        amount: fee * 100,
        currency: 'INR',
        receipt: refId,
        notes: { ref_id: refId, city, team: field('teamName'), lead_phone: field('leadWhatsapp') },
      });

      await pool.query(
        'UPDATE registrations SET ref_id = $1, deck_path = $2, razorpay_order_id = $3 WHERE id = $4',
        [refId, `decks/${deckName}`, order.id, regId]
      );

      res.json({
        refId,
        keyId: RAZORPAY_KEY_ID,
        order: { id: order.id, amount: order.amount, currency: order.currency },
        prefill: { name: field('leadName'), email: field('leadEmail'), contact: field('leadWhatsapp') },
        city,
      });
    } catch (err) {
      cleanupTmp(req.files);
      if (regId) { // roll back a half-created registration (e.g. Razorpay unreachable)
        pool.query('DELETE FROM registrations WHERE id = $1', [regId]).catch(() => {});
        if (deckFile) fs.unlink(deckFile, () => {});
      }
      if (err.status === 400) return res.status(400).json({ error: err.message });
      console.error('register failed:', err);
      res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
    }
  });
});

/* ---------------------------------------------------------
   POST /api/payment/verify — checkout success callback
   Signature proves Razorpay issued it; then confirm with Razorpay's API.
   --------------------------------------------------------- */
app.post('/api/payment/verify', express.json(), async (req, res) => {
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig } = req.body || {};
  if (![orderId, paymentId, sig].every((v) => typeof v === 'string' && v.length < 100))
    return res.status(400).json({ error: 'Invalid payment response.' });
  if (!razorpay || !safeEqual(hmacHex(RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`), sig))
    return res.status(400).json({ error: 'Payment could not be verified.' });

  try {
    const payment = await razorpay.payments.fetch(paymentId);
    if (payment.order_id !== orderId) return res.status(400).json({ error: 'Payment could not be verified.' });
    const result = await settlePayment(payment);
    if (!result.ok) {
      return res.status(402).json({
        error: 'Your payment could not be confirmed yet. If money was deducted, it will be confirmed automatically within an hour. Please do not pay again.',
      });
    }
    res.json({ refId: result.reg.ref_id, paymentId });
  } catch (err) {
    console.error('verify failed:', err);
    res.status(502).json({
      error: 'We could not reach the payment provider. If money was deducted, it will be confirmed automatically. Please do not pay again.',
    });
  }
});

/* ---------------------------------------------------------
   POST /api/razorpay/webhook — Razorpay → server, catches closed tabs.
   Signature is over the raw body, so this route parses it itself.
   --------------------------------------------------------- */
app.post('/api/razorpay/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  const sig = req.headers['x-razorpay-signature'];
  if (!RAZORPAY_WEBHOOK_SECRET || !Buffer.isBuffer(req.body) ||
      !safeEqual(hmacHex(RAZORPAY_WEBHOOK_SECRET, req.body), sig)) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try { event = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).end(); }
  const payment = event.payload?.payment?.entity;

  try {
    if (payment && ['payment.captured', 'payment.authorized', 'order.paid'].includes(event.event)) {
      await settlePayment(payment);
    } else if (payment && event.event === 'payment.failed') {
      await pool.query(
        `UPDATE registrations SET payment_status = 'failed'
          WHERE razorpay_order_id = $1 AND payment_status = 'awaiting_payment'`,
        [payment.order_id]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('webhook failed:', err);
    res.status(500).end(); // Razorpay retries
  }
});

/* ---------------------------------------------------------
   Reconcile — hourly, ask Razorpay about recent unpaid orders in case
   both the verify call and the webhook were missed. Nothing is deleted.
   --------------------------------------------------------- */
async function reconcile() {
  if (!razorpay) return;
  const { rows } = await pool.query(
    `SELECT razorpay_order_id FROM registrations
      WHERE payment_method = 'razorpay' AND payment_status IN ('awaiting_payment', 'failed')
        AND razorpay_order_id IS NOT NULL AND created_at > now() - interval '7 days'`
  );
  for (const { razorpay_order_id: orderId } of rows) {
    try {
      const { items } = await razorpay.orders.fetchPayments(orderId);
      const paid = items.find((p) => p.status === 'captured' || p.status === 'authorized');
      if (paid) await settlePayment(paid);
    } catch (err) {
      console.error(`reconcile ${orderId} failed:`, err.error?.description || err.message);
    }
  }
  for (const [ip, hits] of regHits) if (hits.every((t) => Date.now() - t > 3600 * 1000)) regHits.delete(ip);
}
setInterval(() => reconcile().catch((e) => console.error('reconcile failed:', e)), 3600 * 1000);

const badReq = (message) => Object.assign(new Error(message), { status: 400 });

/* ---------------------------------------------------------
   Admin — password login (env ADMIN_PASS) + signed session cookie
   --------------------------------------------------------- */
const SESSION_HOURS = 12;
const COOKIE = 'dz_admin';

const sign = (exp) =>
  crypto.createHmac('sha256', process.env.ADMIN_PASS).update(String(exp)).digest('hex');

const getCookie = (req) => {
  const m = (req.headers.cookie || '').match(new RegExp(`${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
};

const isAuthed = (req) => {
  const token = getCookie(req);
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Date.now() > +exp) return false;
  const expect = sign(exp);
  return sig.length === expect.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
};

const adminAuth = (req, res, next) => (isAuthed(req) ? next() : res.status(401).json({ error: 'Not logged in' }));

/* brute-force throttle: 8 attempts / 15 min per IP */
const attempts = new Map();
const throttled = (ip) => {
  const a = attempts.get(ip);
  if (a && a.count >= 8 && Date.now() < a.reset) return true;
  return false;
};
const recordAttempt = (ip, ok) => {
  if (ok) return attempts.delete(ip);
  const a = attempts.get(ip) || { count: 0, reset: Date.now() + 15 * 60 * 1000 };
  if (Date.now() > a.reset) { a.count = 0; a.reset = Date.now() + 15 * 60 * 1000; }
  a.count += 1;
  attempts.set(ip, a);
};

app.post('/api/admin/login', express.json(), (req, res) => {
  const ip = req.headers['x-real-ip'] || req.socket.remoteAddress;
  if (throttled(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });

  const given = String(req.body?.password || '');
  const expected = process.env.ADMIN_PASS || '';
  const ok =
    expected.length > 0 &&
    given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));

  recordAttempt(ip, ok);
  if (!ok) return res.status(401).json({ error: 'Wrong password.' });

  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${exp}.${sign(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`
  );
  res.json({ ok: true });
});

app.post('/api/admin/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/admin', (req, res) =>
  res.sendFile(path.join(__dirname, 'views', isAuthed(req) ? 'admin.html' : 'login.html'))
);

/* GET /api/fees — the page shows these, so it always matches what is charged */
app.get('/api/fees', (_req, res) => {
  res.set('Cache-Control', 'no-store').json(CITY_FEES);
});

app.get('/api/admin/registrations', adminAuth, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM registrations ORDER BY created_at DESC');
  res.json(rows);
});

/* Manual verification is only for legacy UPI rows — Razorpay rows are settled by signature */
app.post('/api/admin/registrations/:id/verify', adminAuth, express.json(), async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE registrations SET payment_verified = $1
      WHERE id = $2 AND payment_method = 'upi_manual' RETURNING payment_verified`,
    [!!req.body.verified, req.params.id]
  );
  if (!rows.length) return res.status(400).json({ error: 'Only manual UPI payments can be verified by hand.' });
  res.json(rows[0]);
});

/* Delete a registration + its uploaded deck and screenshot files */
app.post('/api/admin/registrations/:id/delete', adminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT deck_path, screenshot_path FROM registrations WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Registration not found.' });
    for (const rel of [rows[0].deck_path, rows[0].screenshot_path]) {
      if (rel) fs.unlink(path.join(UPLOAD_ROOT, rel), () => {}); // best-effort
    }
    await pool.query('DELETE FROM registrations WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('delete failed:', err);
    res.status(500).json({ error: 'Delete failed.' });
  }
});

app.get('/api/admin/export.csv', adminAuth, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM registrations ORDER BY id');
  const cols = [
    'ref_id', 'city', 'fee', 'team_name', 'team_size', 'lead_name', 'lead_whatsapp', 'lead_email',
    'idea_name', 'stage', 'ideal_investor', 'source', 'created_at',
    'payment_method', 'payment_status', 'payment_verified', 'amount_paid', 'paid_at',
    'razorpay_payment_id', 'razorpay_order_id', 'utr',
  ];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [
    cols.join(','),
    ...rows.map((r) => cols.map((c) => esc(r[c])).join(',')),
  ].join('\n');
  res.type('text/csv').attachment('denzero-registrations.csv').send(csv);
});

/* Uploaded files — admin-only (payment screenshots are sensitive) */
app.use('/files', adminAuth, express.static(UPLOAD_ROOT));

/* ---------------------------------------------------------
   Static form + boot
   --------------------------------------------------------- */
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'], // /terms → terms.html
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'), // cache but always revalidate → updates show on a normal refresh
}));

app.listen(PORT, () => console.log(`Den Zero running on http://localhost:${PORT}`));
