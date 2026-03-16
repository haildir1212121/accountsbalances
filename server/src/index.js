const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const { PORT, initFirebaseAuth } = require('./config');
const { loadCSV } = require('./services/accountMatcher');
const webhookRouter = require('./routes/webhook');

const app = express();

app.use(helmet());
app.use(morgan('combined'));
app.use(express.json());

// Initialise CSV + Firebase auth (called once, cached for serverless cold starts)
let _initPromise = null;
function ensureInit() {
  if (!_initPromise) {
    _initPromise = (async () => {
      loadCSV();
      await initFirebaseAuth();
    })();
  }
  return _initPromise;
}

// Ensure init before every request (handles Vercel serverless cold starts)
app.use(async (_req, _res, next) => {
  try {
    await ensureInit();
    next();
  } catch (err) {
    next(err);
  }
});

// Routes
app.use('/webhook', webhookRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Export for Vercel serverless
module.exports = app;

// Start standalone server when run directly (npm start)
if (require.main === module) {
  ensureInit()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`[server] Webhook server listening on port ${PORT}`);
        console.log(`[server] POST /webhook/icabbi — receives iCabbi booking completions`);
        console.log(`[server] GET  /health          — health check`);
      });
    })
    .catch(err => {
      console.error('[startup] Fatal error:', err);
      process.exit(1);
    });
}
