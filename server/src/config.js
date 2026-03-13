const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const admin = require('firebase-admin');

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const PORT = parseInt(process.env.PORT, 10) || 3000;
const APP_ID = 'balance-t-default';

// Initialize Firebase Admin SDK
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  || path.join(__dirname, '..', 'service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(require(path.resolve(serviceAccountPath))),
  databaseURL: 'https://balance-t-default-rtdb.firebaseio.com'
});

const db = admin.firestore();

module.exports = { db, APP_ID, WEBHOOK_SECRET, PORT };
