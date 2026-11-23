import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 3000);
const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, '../frontend');

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: process.env.APP_BASE_URL || 'http://localhost:3000' }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'day-alertas',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

app.use(express.static(frontendDir));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    error: 'internal_server_error',
    message: process.env.NODE_ENV === 'production' ? 'Erro interno.' : err.message
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Day Alertas disponível na porta ${port}`);
});
