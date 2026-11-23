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

function sign(value) { return crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url'); }
function createSession(email, uid, role) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 60 * 60 * 1000, email, uid, role })).toString('base64url');
  return payload + '.' + sign(payload);
}
function readSession(token) {
  if (!sessionSecret || !token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload)), received = Buffer.from(signature);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() && data.uid ? data : null;
  } catch { return null; }
}
function validSession(token) { return Boolean(readSession(token)); }
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const item = raw.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
}
function requireAdmin(req, res, next) {
  const session = readSession(readCookie(req, cookieName));
  if (!session) return res.status(401).json({ error: 'unauthorized', message: 'Faça login para continuar.' });
  req.session = session;
  next();
}
function requireOwner(req, res, next) {
  if (req.session?.role !== 'admin') return res.status(403).json({ error: 'forbidden', message: 'Somente a administração pode aprovar cadastros.' });
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

app.get('/api/public-config', (_req, res) => res.json({
  apiKey: process.env.FIREBASE_WEB_API_KEY || '',
  authDomain: 'alertasrdprime.firebaseapp.com',
  projectId: 'alertasrdprime',
  appId: '1:575904361143:web:b6e5ade434ed8b714a3b32'
}));
app.get('/api/health', (_req, res) => res.json({
  ok: true, service: 'day-alertas', databaseConfigured: Boolean(db),
  database: 'Firebase Realtime Database', timestamp: new Date().toISOString()
}));
app.post('/api/auth/register', async (req, res) => {
  if (!getApps().length || !db) return res.status(503).json({ error: 'auth_not_configured', message: 'Firebase não está configurado no servidor.' });
  try {
    const idToken = String(req.body?.idToken || '');
    if (!idToken) return res.status(401).json({ error: 'invalid_credentials', message: 'Não foi possível validar o cadastro.' });
    const decoded = await getAuth().verifyIdToken(idToken);
    const email = String(decoded.email || '').trim().toLowerCase();
    if (!email || !decoded.email_verified) {
      return res.status(403).json({ error: 'email_not_verified', message: 'Confirme seu endereço de e-mail pelo link enviado pelo Firebase antes de solicitar acesso.' });
    }
    const ref = db.ref('users/' + decoded.uid);
    const existing = await ref.get();
    const previous = existing.exists() ? existing.val() : {};
    const isAdmin = previous.role === 'admin';
    const name = String(req.body?.name || previous.name || '').trim().slice(0, 120);
    const phone = String(req.body?.phone || previous.phone || '').replace(/[^0-9+]/g, '').slice(0, 20);
    if (!name) return res.status(400).json({ error: 'name_required', message: 'Informe seu nome completo.' });
    const profile = {
      uid: decoded.uid, name, email, phone,
      role: isAdmin ? 'admin' : 'user',
      status: isAdmin ? 'approved' : (previous.status || 'pending'),
      createdAt: previous.createdAt || Date.now(),
      updatedAt: Date.now()
    };
    await ref.set(profile);
    res.status(201).json({ ok: true, status: profile.status, role: profile.role, message: isAdmin ? 'Conta administrativa cadastrada.' : 'Cadastro recebido. Aguarde a aprovação da administração.' });
  } catch (error) {
    console.error('Falha no cadastro:', error.message);
    res.status(401).json({ error: 'invalid_credentials', message: 'Não foi possível validar o cadastro no Firebase.' });
  }
});
app.post('/api/auth/firebase-login', async (req, res) => {
  if (!getApps().length || !db) return res.status(503).json({
    error: 'auth_not_configured', message: 'Configure o Firebase Admin e o Realtime Database no Render.'
  });
  try {
    const idToken = String(req.body?.idToken || '');
    if (!idToken) return res.status(401).json({ error: 'invalid_credentials', message: 'Entre com seu e-mail e senha do Firebase.' });
    const decoded = await getAuth().verifyIdToken(idToken);
    const email = String(decoded.email || '').trim().toLowerCase();
    if (!decoded.email_verified) return res.status(403).json({ error: 'email_not_verified', message: 'Confirme seu endereço de e-mail antes de entrar.' });
    const profileRef = db.ref('users/' + decoded.uid);
    const snap = await profileRef.get();
    if (!snap.exists()) return res.status(403).json({ error: 'registration_required', message: 'Cadastro não localizado. Saia e conclua o cadastro primeiro.' });
    const profile = snap.val();
    if (profile.status !== 'approved') return res.status(403).json({
      error: profile.status === 'rejected' ? 'registration_rejected' : 'approval_pending',
      message: profile.status === 'rejected' ? 'Seu cadastro não foi aprovado. Entre em contato com a administração.' : 'Seu cadastro está aguardando aprovação da administração.'
    });
    const role = profile.role === 'admin' ? 'admin' : 'user';
    res.cookie(cookieName, createSession(email, decoded.uid, role), {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict', maxAge: 12 * 60 * 60 * 1000, path: '/'
    });
    res.json({ ok: true, email, role });
  } catch (error) {
    console.error('Falha no login Firebase:', error.message);
    res.status(401).json({ error: 'invalid_credentials', message: 'Não foi possível validar seu acesso no Firebase.' });
  }
});
app.get('/api/admin/users', requireAdmin, requireOwner, requireDatabase, async (_req, res, next) => {
  try {
    const users = valuesOf(await db.ref('users').get());
    res.json(Object.entries(users).map(([uid, user]) => ({ uid, name: user.name || '', email: user.email || '', phone: user.phone || '', status: user.status || 'pending', role: user.role || 'user', createdAt: user.createdAt || 0 })).sort((a,b) => b.createdAt - a.createdAt));
  } catch (error) { next(error); }
});
app.patch('/api/admin/users/:uid/approval', requireAdmin, requireOwner, requireDatabase, async (req, res, next) => {
  try {
    const uid = String(req.params.uid || '');
    const status = String(req.body?.status || '');
    if (!uid || !['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'invalid_status', message: 'Ação de aprovação inválida.' });
    if (uid === req.session.uid) return res.status(400).json({ error: 'invalid_target', message: 'Não é possível alterar o próprio acesso por esta tela.' });
    const ref = db.ref('users/' + uid);
    const snap = await ref.get();
    if (!snap.exists()) return res.status(404).json({ error: 'user_not_found', message: 'Cadastro não encontrado.' });
    const user = snap.val();
    if (user.role === 'admin') return res.status(403).json({ error: 'protected_user', message: 'Não é possível alterar outro administrador.' });
    await ref.update({ status, reviewedAt: Date.now(), reviewedBy: req.session.uid, updatedAt: Date.now() });
    res.json({ ok: true, uid, status });
  } catch (error) { next(error); }
});
app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(cookieName, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' });
  res.json({ ok: true });
});
app.get('/api/auth/me', (req, res) => {
  const session = readSession(readCookie(req, cookieName));
  res.json({
    authenticated: Boolean(session), role: session?.role || null, uid: session?.uid || null,
    authConfigured: Boolean(getApps().length && db), databaseConfigured: Boolean(db)
  });
});

app.get('/api/dashboard', requireAdmin, requireDatabase, async (_req, res, next) => {
  try {
    const root = db.ref('accounts/' + req.session.uid);
    const [listsSnap, contactsSnap, importsSnap] = await Promise.all([
      root.child('contact_lists').get(), root.child('contacts').get(), root.child('imports').get()
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
    const data = valuesOf(await db.ref('accounts/' + req.session.uid + '/contact_lists').get());
    res.json(Object.entries(data).map(([id, value]) => asList(id, value)).sort((a,b) => b.createdAt - a.createdAt));
  } catch (error) { next(error); }
});
app.post('/api/lists', requireAdmin, requireDatabase, async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 120);
    const description = String(req.body?.description || '').trim().slice(0, 500);
    if (!name) return res.status(400).json({ error: 'name_required', message: 'Informe o nome da lista.' });
    const ref = db.ref('accounts/' + req.session.uid + '/contact_lists').push();
    const value = { name, description, contactCount: 0, createdAt: Date.now() };
    await ref.set(value);
    res.status(201).json({ id: ref.key, ...value, contacts: 0 });
  } catch (error) { next(error); }
});
app.get('/api/imports', requireAdmin, requireDatabase, async (_req, res, next) => {
  try {
    const root = db.ref('accounts/' + req.session.uid);
    const [importsSnap, listsSnap] = await Promise.all([root.child('imports').get(), root.child('contact_lists').get()]);
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
    const root = db.ref('accounts/' + req.session.uid);
    const listRef = root.child('contact_lists/' + listId);
    const listSnap = await listRef.get();
    if (!listSnap.exists()) return res.status(400).json({ error: 'list_not_found', message: 'Selecione uma lista válida.' });
    const rows = await parseUpload(req.file);
    if (!rows.length) return res.status(400).json({ error: 'empty_file', message: 'O arquivo não contém linhas de dados.' });
    if (rows.length > 20000) return res.status(413).json({ error: 'too_many_rows', message: 'O limite por importação é de 20.000 linhas.' });

    const importRef = root.child('imports').push();
    const importRecord = {
      listId, original_filename: req.file.originalname.slice(0, 255),
      status: 'processing', total_rows: rows.length, imported_rows: 0,
      duplicate_rows: 0, rejected_rows: 0, createdAt: Date.now()
    };
    await importRef.set(importRecord);

    const contacts = valuesOf(await root.child('contacts').get());
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
        const ref = root.child('contacts').push();
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
    await root.update(updates);
    res.status(201).json({ id: importRef.key, total: rows.length, imported, duplicates, rejected });
  } catch (error) { next(error); }
});
app.get('/api/contacts', requireAdmin, requireDatabase, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().toLocaleLowerCase('pt-BR').slice(0, 100);
    const data = valuesOf(await db.ref('accounts/' + req.session.uid + '/contacts').get());
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
