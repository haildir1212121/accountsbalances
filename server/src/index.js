const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const { PORT } = require('./config');
const { loadCSV } = require('./services/accountMatcher');
const webhookRouter = require('./routes/webhook');

const app = express();

app.use(helmet());
app.use(morgan('combined'));
app.use(express.json());

// Routes
app.use('/webhook', webhookRouter);

// Health check for Azure
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Load account CSV then start server
try {
  loadCSV();
} catch (err) {
  console.error('[startup] Failed to load accounts.csv:', err.message);
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`[server] Webhook server listening on port ${PORT}`);
  console.log(`[server] POST /webhook/icabbi — receives iCabbi booking completions`);
  console.log(`[server] GET  /health          — health check`);
});
