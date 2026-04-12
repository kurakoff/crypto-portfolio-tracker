import express from 'express';
import cors from 'cors';
import { config } from './config/rpc';
import { authMiddleware } from './middleware/auth';
import authRouter from './routes/auth';
import walletsRouter from './routes/wallets';
import portfolioRouter from './routes/portfolio';
import exportRouter from './routes/export';
import transactionsRouter from './routes/transactions';

const app = express();

app.use(cors());
app.use(express.json());

// Public routes
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});
app.use('/api/auth', authRouter);

// Protected routes
app.use('/api/wallets', authMiddleware, walletsRouter);
app.use('/api/portfolio', authMiddleware, portfolioRouter);
app.use('/api/export', authMiddleware, exportRouter);
app.use('/api/transactions', authMiddleware, transactionsRouter);

// Note: Frontend is deployed separately (Coolify static site).
// SPA routing (e.g. /wallets) must be configured in frontend's nginx:
//   location / { try_files $uri $uri/ /index.html; }

app.listen(config.port, () => {
  console.log(`Backend running on http://localhost:${config.port}`);
});
