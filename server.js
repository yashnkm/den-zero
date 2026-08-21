/* ============================================================
   DEN ZERO — registration backend
   Express + Postgres + local disk uploads
   ============================================================ */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PORT = process.env.PORT || 8642;
const UPLOAD_ROOT = path.join(__dirname, 'uploads');
const TMP_DIR = path.join(UPLOAD_ROOT, 'tmp');
const DECK_DIR = path.join(UPLOAD_ROOT, 'decks');
const SHOT_DIR = path.join(UPLOAD_ROOT, 'payments');
[TMP_DIR, DECK_DIR, SHOT_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));

/* ---------------------------------------------------------
   Uploads — to tmp first, renamed to the ref id after insert
   --------------------------------------------------------- */
const upload = multer({
  storage: multer.diskStorage({
    destination: TMP_DIR,
    filename: (_req, file, cb) =>
      cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    const ok =
      (file.fieldname === 'deckFile' && file.mimetype === 'application/pdf') ||
      (file.fieldname === 'shotFile' &&
        (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf'));
    cb(ok ? null : new Error(`Invalid file type for ${file.fieldname}`), ok);
  },
}).fields([
  { name: 'deckFile', maxCount: 1 },
  { name: 'shotFile', maxCount: 1 },
]);

const cleanupTmp = (files) =>
  Object.values(files || {})
    .flat()
    .forEach((f) => fs.unlink(f.path, () => {}));

/* ---------------------------------------------------------
   POST /api/register
   --------------------------------------------------------- */
app.post('/api/register', (req, res) => {
  upload(req, res, async (uploadErr) => {
    if (uploadErr) {
      cleanupTmp(req.files);
      const msg =
        uploadErr.code === 'LIMIT_FILE_SIZE'
          ? 'A file is too large (deck max 10 MB, screenshot max 5 MB).'
          : uploadErr.message;
      return res.status(400).json({ error: msg });
    }

    const b = req.body;
    const deck = req.files?.deckFile?.[0];
    const shot = req.files?.shotFile?.[0];

    try {
      /* ---- validate ---- */
      const teamSize = parseInt(b.teamSize, 10);
      if (![1, 2, 3].includes(teamSize)) throw badReq('Invalid team size.');

      const required = [
        'teamName', 'leadName', 'leadWhatsapp', 'leadEmail',
        'ideaName', 'stage', 'problem', 'solution', 'audience',
        'unique', 'progress', 'idealInvestor', 'utr', 'source',
      ];
      for (const f of required) {
        if (!b[f] || !String(b[f]).trim()) throw badReq(`Missing field: ${f}`);
      }
      if (!deck) throw badReq('Pitch deck is required.');
      if (!shot) throw badReq('Payment screenshot is required.');
      if (shot.size > 5 * 1024 * 1024) throw badReq('Screenshot must be under 5 MB.');
      if (!/^[A-Za-z0-9\-]{8,30}$/.test(b.utr.trim()))
        throw badReq('UTR / transaction ID looks invalid.');
      if (!/^\d{10}$/.test(b.leadWhatsapp.trim()))
        throw badReq('WhatsApp number must be exactly 10 digits.');

      const today = new Date().toISOString().slice(0, 10);
      const members = [];
      for (let i = 0; i < teamSize; i++) {
        const m = {
          name: b[`m${i}-name`], college: b[`m${i}-college`],
          course: b[`m${i}-course`], email: b[`m${i}-email`],
          phone: b[`m${i}-phone`], dob: b[`m${i}-dob`],
          linkedin: b[`m${i}-linkedin`] || null,
        };
        if (!m.name || !m.college || !m.course || !m.email || !m.phone || !m.dob)
          throw badReq(`Member ${i + 1} details are incomplete.`);
        if (!/^\d{10}$/.test(String(m.phone).trim()))
          throw badReq(`Member ${i + 1} phone must be exactly 10 digits.`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(m.dob))
          throw badReq(`Member ${i + 1} date of birth is invalid.`);
        if (m.dob < '1995-01-01')
          throw badReq(`Member ${i + 1} must be born on or after 1 Jan 1995.`);
        if (m.dob > today)
          throw badReq(`Member ${i + 1} date of birth can't be in the future.`);
        members.push(m);
      }

      const lookingFor = [].concat(b.lookingFor || []);
      if (!lookingFor.length) throw badReq('Select at least one "looking for" option.');

      /* ---- insert ---- */
      const { rows } = await pool.query(
        `INSERT INTO registrations
           (team_name, team_size, members, lead_name, lead_whatsapp, lead_email,
            idea_name, stage, problem, solution, audience, unique_edge, progress,
            ideal_investor, utr, source, looking_for)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING id`,
        [
          b.teamName.trim(), teamSize, JSON.stringify(members),
          b.leadName.trim(), b.leadWhatsapp.trim(), b.leadEmail.trim(),
          b.ideaName.trim(), b.stage, b.problem.trim(), b.solution.trim(),
          b.audience.trim(), b.unique.trim(), b.progress.trim(),
          b.idealInvestor.trim(), b.utr.trim(), b.source, lookingFor,
        ]
      );

      const id = rows[0].id;
      const refId = `DZ-26-${String(1000 + id)}`;

      /* ---- move files into place, store paths ---- */
      const deckName = `${refId}-deck${path.extname(deck.filename)}`;
      const shotName = `${refId}-payment${path.extname(shot.filename)}`;
      fs.renameSync(deck.path, path.join(DECK_DIR, deckName));
      fs.renameSync(shot.path, path.join(SHOT_DIR, shotName));

      await pool.query(
        `UPDATE registrations SET ref_id = $1, deck_path = $2, screenshot_path = $3 WHERE id = $4`,
        [refId, `decks/${deckName}`, `payments/${shotName}`, id]
      );

      res.json({ refId });
    } catch (err) {
      cleanupTmp(req.files);
      if (err.status === 400) return res.status(400).json({ error: err.message });
      console.error('register failed:', err);
      res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
    }
  });
});

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

app.get('/api/admin/registrations', adminAuth, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM registrations ORDER BY created_at DESC');
  res.json(rows);
});

app.post('/api/admin/registrations/:id/verify', adminAuth, express.json(), async (req, res) => {
  const { rows } = await pool.query(
    'UPDATE registrations SET payment_verified = $1 WHERE id = $2 RETURNING payment_verified',
    [!!req.body.verified, req.params.id]
  );
  res.json(rows[0] || {});
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
    'ref_id', 'team_name', 'team_size', 'lead_name', 'lead_whatsapp', 'lead_email',
    'idea_name', 'stage', 'ideal_investor', 'utr', 'payment_verified', 'source', 'created_at',
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
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'), // cache but always revalidate → updates show on a normal refresh
}));

app.listen(PORT, () => console.log(`Den Zero running on http://localhost:${PORT}`));
