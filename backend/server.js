import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';

const app = express();
const port = Number(process.env.PORT || 3000);
const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, '../frontend');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

let db = null;
let firebaseInitError = '';
try {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const serviceAccount = JSON.parse(raw);
    if (!getApps().length) initializeApp({
      credential: cert({
        projectId: serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID,
        clientEmail: serviceAccount.client_email,
        privateKey: String(serviceAccount.private_key || '').replace(/\\n/g, '\n')
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://alertasrdprime-default-rtdb.firebaseio.com'
    });
    db = getDatabase();
  } else {
    firebaseInitError = 'FIREBASE_SERVICE_ACCOUNT não configurada.';
  }
} catch (error) {
  firebaseInitError = error.message;
  console.error('Firebase não inicializado:', error.message);
}

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

const cookieName = 'day_alertas_session';
const sessionSecret = process.env.SESSION_SECRET || '';
const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();

function sign(value) { return crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url'); }
function createSession(email, uid) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 60 * 60 * 1000, email, uid })).toString('base64url');
  return payload + '.' + sign(payload);
}
function validSession(token) {
  if (!sessionSecret || !token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = Buffer.from(sign(payload)), received = Buffer.from(signature);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const item = raw.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
}
function requireAdmin(req, res, next) {
  if (!validSession(readCookie(req, cookieName))) return res.status(401).json({ error: 'unauthorized', message: 'Faça login para continuar.' });
  next();
}
function requireDatabase(req, res, next) {
  if (!db) return res.status(503).json({ error: 'database_not_configured', message: 'Firebase ainda não está conectado. Configure a credencial de serviço no Render.' });
  next();
}
function normalizeHeader(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
const aliases = {
  name: ['nome','name','nomecompleto','fullname','contato','cliente','primeironome','firstname'],
  email: ['email','e-mail','correioeletronico','mail'],
  phone: ['telefone','celular','whatsapp','fone','phone','mobile','numerodtelefone','numerotelefone','dddtelefone','contato1'],
  city: ['cidade','city','municipio'], state: ['estado','uf','state'],
  interest: ['interesse','imovel','tipoimovel','categoria','interest'],
  source: ['origem','source','fonte','formulario','campaign']
};
function getField(row, key) {
  const keys = Object.keys(row);
  const found = keys.find(k => aliases[key].includes(normalizeHeader(k)));
  return found ? String(row[found] ?? '').trim() : '';
}
function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
  if (digits.length < 12 || digits.length > 13) return null;
  return '+' + digits;
}
async function parseUpload(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.csv' || ext === '.txt') {
    const content = file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    const firstLine = content.split(/\r?\n/, 1)[0] || '';
    const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    return parseCsv(content, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true, trim: true, delimiter });
  }
  if (ext === '.xlsx') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('A planilha não possui uma aba com dados.');
    const headers = [];
    sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { headers[col] = String(cell.text || '').trim(); });
    const rows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const item = {};
      headers.forEach((header, index) => { if (header) item[header] = row.getCell(index).text || ''; });
      if (Object.values(item).some(v => String(v).trim())) rows.push(item);
    });
    return rows;
  }
  throw new Error('Formato não suportado. Envie um arquivo .csv ou .xlsx.');
}
function valuesOf(snapshot) { return snapshot.exists() ? snapshot.val() || {} : {}; }
function asList(id, value) { return { id, ...value, contacts: Number(value.contactCount || 0) }; }

app.get('/api/health', (_req, res) => res.json({
  ok: true, service: 'day-alertas', databaseConfigured: Boolean(db),
  database: 'Firebase Realtime Database', timestamp: new Date().toISOString()
}));
app.post('/api/auth/firebase-login', async (req, res) => {
  if (!adminEmail || !getApps().length) return res.status(503).json({
    error: 'auth_not_configured',
    message: 'Configure ADMIN_EMAIL e FIREBASE_SERVICE_ACCOUNT no Render.'
  });
  try {
    const idToken = String(req.body?.idToken || '');
    if (!idToken) return res.status(401).json({ error: 'invalid_credentials', message: 'Entre com seu e-mail e senha do Firebase.' });
    const decoded = await getAuth().verifyIdToken(idToken);
    if (String(decoded.email || '').trim().toLowerCase() !== adminEmail) {
      return res.status(403).json({ error: 'not_authorized', message: 'Este usuário não tem permissão para acessar o painel.' });
    }
    res.cookie(cookieName, createSession(adminEmail, decoded.uid), {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict', maxAge: 12 * 60 * 60 * 1000, path: '/'
    });
    res.json({ ok: true, email: adminEmail });
  } catch {
    res.status(401).json({ error: 'invalid_credentials', message: 'Não foi possível validar seu acesso no Firebase.' });
  }
});
app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(cookieName, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' });
  res.json({ ok: true });
});
app.get('/api/auth/me', (req, res) => res.json({
  authenticated: validSession(readCookie(req, cookieName)),
  authConfigured: Boolean(adminEmail && getApps().length), adminEmail, databaseConfigured: Boolean(db)
}));

app.get('/api/dashboard', requireAdmin, requireDatabase, async (_req, res, next) => {
  try {
    const [listsSnap, contactsSnap, importsSnap] = await Promise.all([
      db.ref('contact_lists').get(), db.ref('contacts').get(), db.ref('imports').get()
    ]);
    const lists = valuesOf(listsSnap), contacts = valuesOf(contactsSnap), imports = valuesOf(importsSnap);
    res.json({
      lists: Object.keys(lists).length,
      contacts: Object.values(contacts).filter(c => c.status !== 'unsubscribed').length,
      imports: Object.values(imports).filter(i => i.status === 'completed').length
    });
  } catch (error) { next(error); }
});
app.get('/api/lists', requireAdmin, requireDatabase, async (_req, res, next) => {
  try {
    const data = valuesOf(await db.ref('contact_lists').get());
    res.json(Object.entries(data).map(([id, value]) => asList(id, value)).sort((a,b) => b.createdAt - a.createdAt));
  } catch (error) { next(error); }
});
app.post('/api/lists', requireAdmin, requireDatabase, async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 120);
    const description = String(req.body?.description || '').trim().slice(0, 500);
    if (!name) return res.status(400).json({ error: 'name_required', message: 'Informe o nome da lista.' });
    const ref = db.ref('contact_lists').push();
    const value = { name, description, contactCount: 0, createdAt: Date.now() };
    await ref.set(value);
    res.status(201).json({ id: ref.key, ...value, contacts: 0 });
  } catch (error) { next(error); }
});
app.get('/api/imports', requireAdmin, requireDatabase, async (_req, res, next) => {
  try {
    const [importsSnap, listsSnap] = await Promise.all([db.ref('imports').get(), db.ref('contact_lists').get()]);
    const imports = valuesOf(importsSnap), lists = valuesOf(listsSnap);
    res.json(Object.entries(imports).map(([id, value]) => ({
      id, ...value, list_name: lists[value.listId]?.name || 'Lista'
    })).sort((a,b) => b.createdAt - a.createdAt).slice(0, 100));
  } catch (error) { next(error); }
});
app.post('/api/imports', requireAdmin, requireDatabase, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file_required', message: 'Selecione um arquivo.' });
    const listId = String(req.body.listId || '');
    const listRef = db.ref('contact_lists/' + listId);
    const listSnap = await listRef.get();
    if (!listSnap.exists()) return res.status(400).json({ error: 'list_not_found', message: 'Selecione uma lista válida.' });
    const rows = await parseUpload(req.file);
    if (!rows.length) return res.status(400).json({ error: 'empty_file', message: 'O arquivo não contém linhas de dados.' });
    if (rows.length > 20000) return res.status(413).json({ error: 'too_many_rows', message: 'O limite por importação é de 20.000 linhas.' });

    const importRef = db.ref('imports').push();
    const importRecord = {
      listId, original_filename: req.file.originalname.slice(0, 255),
      status: 'processing', total_rows: rows.length, imported_rows: 0,
      duplicate_rows: 0, rejected_rows: 0, createdAt: Date.now()
    };
    await importRef.set(importRecord);

    const contacts = valuesOf(await db.ref('contacts').get());
    const emailIndex = new Map(), phoneIndex = new Map();
    for (const [id, c] of Object.entries(contacts)) {
      if (c.email) emailIndex.set(c.email, id);
      if (c.phone) phoneIndex.set(c.phone, id);
    }
    let imported = 0, duplicates = 0, rejected = 0;
    const updates = {};
    for (const row of rows) {
      const name = getField(row, 'name').slice(0, 180) || null;
      const email = normalizeEmail(getField(row, 'email'));
      const phone = normalizePhone(getField(row, 'phone'));
      const city = getField(row, 'city').slice(0, 100) || null;
      const state = getField(row, 'state').slice(0, 40) || null;
      const interest = getField(row, 'interest').slice(0, 160) || null;
      const source = getField(row, 'source').slice(0, 160) || null;
      if (!email && !phone) { rejected++; continue; }
      const existingId = (email && emailIndex.get(email)) || (phone && phoneIndex.get(phone));
      if (existingId) {
        const existing = contacts[existingId] || {};
        const next = {
          ...existing,
          full_name: existing.full_name || name,
          city: existing.city || city, state: existing.state || state,
          interest: existing.interest || interest,
          listIds: { ...(existing.listIds || {}), [listId]: true },
          updatedAt: Date.now()
        };
        contacts[existingId] = next;
        updates['contacts/' + existingId] = next;
        duplicates++;
      } else {
        const ref = db.ref('contacts').push();
        const value = {
          email, phone, full_name: name, city, state, interest,
          source: source || req.file.originalname.slice(0, 160),
          status: 'active', listIds: { [listId]: true },
          sourceImportId: importRef.key, createdAt: Date.now(), updatedAt: Date.now()
        };
        contacts[ref.key] = value;
        updates['contacts/' + ref.key] = value;
        if (email) emailIndex.set(email, ref.key);
        if (phone) phoneIndex.set(phone, ref.key);
        imported++;
      }
    }
    const currentList = listSnap.val();
    updates['contact_lists/' + listId] = {
      ...currentList, contactCount: Object.values(contacts).filter(c => c.listIds?.[listId] && c.status !== 'unsubscribed').length,
      updatedAt: Date.now()
    };
    updates['imports/' + importRef.key] = {
      ...importRecord, status: 'completed', imported_rows: imported,
      duplicate_rows: duplicates, rejected_rows: rejected, completedAt: Date.now()
    };
    await db.ref().update(updates);
    res.status(201).json({ id: importRef.key, total: rows.length, imported, duplicates, rejected });
  } catch (error) { next(error); }
});
app.get('/api/contacts', requireAdmin, requireDatabase, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().toLocaleLowerCase('pt-BR').slice(0, 100);
    const data = valuesOf(await db.ref('contacts').get());
    const rows = Object.entries(data).map(([id, c]) => ({
      id, full_name: c.full_name, email: c.email, phone: c.phone,
      city: c.city, state: c.state, interest: c.interest,
      status: c.status || 'active', created_at: c.createdAt
    })).filter(c => !q || [c.full_name,c.email,c.phone,c.city,c.state,c.interest].some(v => String(v || '').toLocaleLowerCase('pt-BR').includes(q)))
      .sort((a,b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, 200);
    res.json(rows);
  } catch (error) { next(error); }
});

app.use(express.static(frontendDir));
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err instanceof multer.MulterError ? 400 : 500;
  res.status(status).json({
    error: 'request_failed',
    message: status === 400 ? 'Arquivo inválido ou maior que 10 MB.' : (process.env.NODE_ENV === 'production' ? 'Não foi possível concluir a operação.' : err.message)
  });
});
app.listen(port, '0.0.0.0', () => {
  if (db) console.log('Firebase Realtime Database configurado.');
  else console.warn('Firebase aguardando credencial administrativa:', firebaseInitError);
  console.log(`Day Alertas disponível na porta ${port}`);
});
