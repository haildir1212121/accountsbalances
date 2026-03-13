const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { initializeApp } = require('firebase/app');
const { getAuth, signInAnonymously } = require('firebase/auth');
const { getFirestore } = require('firebase/firestore');

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const PORT = parseInt(process.env.PORT, 10) || 3000;
const APP_ID = 'balance-t-default';

// Same config as index.html:264-273
const firebaseConfig = {
  apiKey: "AIzaSyB-P87cAnvDHpCoPocqhjHE9zGaDQXxe2U",
  authDomain: "balance-t.firebaseapp.com",
  databaseURL: "https://balance-t-default-rtdb.firebaseio.com",
  projectId: "balance-t",
  storageBucket: "balance-t.firebasestorage.app",
  messagingSenderId: "893924100931",
  appId: "1:893924100931:web:70427b3ff655341594fdf6",
  measurementId: "G-5RJM9SQDS1"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function initFirebaseAuth() {
  try {
    await signInAnonymously(auth);
    console.log('[firebase] Signed in anonymously');
  } catch (err) {
    console.error('[firebase] Anonymous auth failed:', err.message);
    throw err;
  }
}

module.exports = { db, APP_ID, WEBHOOK_SECRET, PORT, initFirebaseAuth };
