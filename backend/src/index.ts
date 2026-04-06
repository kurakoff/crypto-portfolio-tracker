import express from 'express';
import cors from 'cors';
import { config } from './config/rpc';
import walletsRouter from './routes/wallets';
import portfolioRouter from './routes/portfolio';
import exportRouter from './routes/export';
import transactionsRouter from './routes/transactions';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/wallets', walletsRouter);
app.use('/api/portfolio', portfolioRouter);
app.use('/api/export', exportRouter);
app.use('/api/transactions', transactionsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(config.port, () => {
  console.log(`Backend running on http://localhost:${config.port}`);
});
