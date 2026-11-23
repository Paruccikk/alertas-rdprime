import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';
import pg from 'pg';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, '../frontend');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
}) : null;

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(cors({ origin: process.env.APP_BASE_URL || true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

const cookieName = 'day_alertas_session';
const sessionSecret = process.env.SESSION_SECRET || '';
const adminPassword = process.env.ADMIN_PASSWORD || '';

function sign(value) {
  return crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');
}
function createSession() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  return payload + '.' + sign(payload);
}
function validSession(token) {
  if (!sessionSecret || !token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); }
  catch { return false; }
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
  if (!pool) return res.status(503).json({ error: 'database_not_configured', message: 'Banco de dados ainda não configurado.' });
  next();
}
function normalizeHeader(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
const aliases = {
  name: ['nome','name','nomecompleto','fullname','contato','cliente','primeironome','firstname'],
  email: ['email','e-mail','correioeletronico','mail'],
  phone: ['telefone','celular','whatsapp','fone','phone','mobile','numerod telefone','numerotelefone','dddtelefone','contato1'],
  city: ['cidade','city','municipio'],
  state: ['estado','uf','state'],
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
    const text = file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    return parseCsv(text, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true, trim: true });
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

app.get('/api/health', (_req, res) => res.json({
  ok: true, service: 'day-alertas', databaseConfigured: Boolean(pool),
  timestamp: new Date().toISOString()
}));

app.post('/api/auth/login', (req, res) => {
  if (!adminPassword || !sessionSecret) return res.status(503).json({ error: 'auth_not_configured', message: 'Configure ADMIN_PASSWORD e SESSION_SECRET no Render.' });
  const password = String(req.body?.password || '');
  const a = Buffer.from(password);
  const b = Buffer.from(adminPassword);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'invalid_credentials', message: 'Senha incorreta.' });
  res.cookie(cookieName, createSession(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 12 * 60 * 60 * 1000, path: '/' });
  res.json({ ok: true });
});
app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(cookieName, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' });
  res.json({ ok: true });
});
app.get('/api/auth/me', (req, res) => res.json({ authenticated: validSession(readCookie(req, cookieName)), authConfigured: Boolean(adminPassword && sessionSecret), databaseConfigured: Boolean(pool) }));

app.get('/api/dashboard', requireAdmin, requireDatabase, async (_req, res, next) => {
  try {
    const [lists, contacts, imports] = await Promise.all([
      pool.query('SELECT count(*)::int AS total FROM contact_lists'),
      pool.query('SELECT count(*)::int AS total FROM contacts WHERE status = $1', ['active']),
      pool.query("SELECT count(*)::int AS total FROM imports WHERE status = 'completed'")
    ]);
    res.json({ lists: lists.rows[0].total, contacts: contacts.rows[0].total, imports: imports.rows[0].total });
  } catch (error) { next(error); }
});
app.get('/api/lists', requireAdmin, requireDatabase, async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT l.id, l.name, l.description, l.created_at,
      count(c.id)::int AS contacts
      FROM contact_lists l LEFT JOIN contacts c ON c.source_import_id IN
        (SELECT i.id FROM imports i WHERE i.list_id = l.id)
      GROUP BY l.id ORDER BY l.created_at DESC`);
    res.json(result.rows);
  } catch (error) { next(error); }
});
app.post('/api/lists', requireAdmin, requireDatabase, async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 120);
    const description = String(req.body?.description || '').trim().slice(0, 500);
    if (!name) return res.status(400).json({ error: 'name_required', message: 'Informe o nome da lista.' });
    const result = await pool.query('INSERT INTO contact_lists(name, description) VALUES($1,$2) RETURNING id,name,description,created_at', [name, description]);
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});
app.get('/api/imports', requireAdmin, requireDatabase, async (_req, res, next) => {
  try {
    const result = await pool.query(`SELECT i.id, i.original_filename, i.status, i.total_rows,
      i.imported_rows, i.rejected_rows, i.created_at, l.name AS list_name
      FROM imports i LEFT JOIN contact_lists l ON l.id = i.list_id
      ORDER BY i.created_at DESC LIMIT 100`);
    res.json(result.rows);
  } catch (error) { next(error); }
});
app.post('/api/imports', requireAdmin, requireDatabase, upload.single('file'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!req.file) return res.status(400).json({ error: 'file_required', message: 'Selecione um arquivo.' });
    const listId = String(req.body.listId || '');
    const list = await client.query('SELECT id FROM contact_lists WHERE id = $1', [listId]);
    if (!list.rowCount) return res.status(400).json({ error: 'list_not_found', message: 'Selecione uma lista válida.' });
    const rows = await parseUpload(req.file);
    if (!rows.length) return res.status(400).json({ error: 'empty_file', message: 'O arquivo não contém linhas de dados.' });
    if (rows.length > 20000) return res.status(413).json({ error: 'too_many_rows', message: 'O limite por importação é de 20.000 linhas.' });
    await client.query('BEGIN');
    const importResult = await client.query(
      `INSERT INTO imports(list_id, original_filename, stored_path, status, total_rows)
       VALUES($1,$2,$3,'processing',$4) RETURNING id`,
      [listId, req.file.originalname.slice(0, 255), 'memory://processed', rows.length]
    );
    const importId = importResult.rows[0].id;
    let imported = 0, duplicates = 0, rejected = 0;
    for (const row of rows) {
      const name = getField(row, 'name').slice(0, 180) || null;
      const email = normalizeEmail(getField(row, 'email'));
      const phone = normalizePhone(getField(row, 'phone'));
      const city = getField(row, 'city').slice(0, 100) || null;
      const state = getField(row, 'state').slice(0, 40) || null;
      const interest = getField(row, 'interest').slice(0, 160) || null;
      const source = getField(row, 'source').slice(0, 160) || null;
      if (!email && !phone) { rejected++; continue; }
      const existing = await client.query(
        'SELECT id FROM contacts WHERE ($1::text IS NOT NULL AND email_normalized=$1) OR ($2::text IS NOT NULL AND phone_e164=$2) LIMIT 1',
        [email, phone]
      );
      if (existing.rowCount) {
        await client.query(
          `UPDATE contacts SET full_name=COALESCE(full_name,$2),
             city=COALESCE(city,$3), state=COALESCE(state,$4), interest=COALESCE(interest,$5),
             updated_at=now() WHERE id=$1`,
          [existing.rows[0].id, name, city, state, interest]
        );
        duplicates++;
        continue;
      }
      try {
        await client.query(
          `INSERT INTO contacts(email_normalized, phone_e164, full_name, city, state, interest, source, source_import_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [email, phone, name, city, state, interest, source || req.file.originalname.slice(0, 160), importId]
        );
        imported++;
      } catch (error) {
        if (error.code === '23505') duplicates++;
        else throw error;
      }
    }
    await client.query(
      `UPDATE imports SET status='completed', imported_rows=$2, rejected_rows=$3 WHERE id=$1`,
      [importId, imported, rejected]
    );
    await client.query('COMMIT');
    res.status(201).json({ id: importId, total: rows.length, imported, duplicates, rejected });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally { client.release(); }
});
app.get('/api/contacts', requireAdmin, requireDatabase, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const result = await pool.query(
      `SELECT id, full_name, email_normalized AS email, phone_e164 AS phone, city, state, interest, status, created_at
       FROM contacts
       WHERE ($1 = '' OR full_name ILIKE '%' || $1 || '%' OR email_normalized ILIKE '%' || $1 || '%' OR phone_e164 ILIKE '%' || $1 || '%')
       ORDER BY created_at DESC LIMIT 200`, [q]
    );
    res.json(result.rows);
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

async function start() {
  if (pool) {
    try {
      const schema = await fs.readFile(path.resolve(here, '../database/schema.sql'), 'utf8');
      await pool.query(schema);
      console.log('Banco de dados conectado e estrutura verificada.');
    } catch (error) {
      console.error('Falha ao preparar o banco de dados:', error.message);
    }
  } else {
    console.warn('DATABASE_URL não configurada. API de dados ficará indisponível até conectar o PostgreSQL.');
  }
  app.listen(port, '0.0.0.0', () => console.log(`Day Alertas disponível na porta ${port}`));
}
start();
