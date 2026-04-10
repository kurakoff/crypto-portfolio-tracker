import express from 'express';
import cors from 'cors';
import path from 'path';
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

// Serve frontend static files in production
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
console.log(`[spa] Serving static from: ${frontendDist}`);
app.use(express.static(frontendDist));

// SPA fallback: any non-API route → index.html
app.get('*', (_req, res) => {
  const indexPath = path.join(frontendDist, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error(`[spa] Failed to serve ${indexPath}:`, err.message);
      res.status(404).send('index.html not found — check build output path');
    }
  });
});

app.listen(config.port, () => {
  console.log(`Backend running on http://localhost:${config.port}`);
});
