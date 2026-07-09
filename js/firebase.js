// Firebase init — SDK modular via CDN (zero build)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, addDoc, updateDoc, deleteDoc,
  getDoc, getDocs, query, where, orderBy, onSnapshot,
  serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Config ini memang public untuk static site.
// Data dikunci oleh Security Rules (per-uid) + Authorized Domains.
const firebaseConfig = {
  apiKey: "AIzaSyD2IADkkmCeMx9ERSdBzSRh4hsEkSNk99s",
  authDomain: "xiesandi-finance-tracker.firebaseapp.com",
  projectId: "xiesandi-finance-tracker",
  storageBucket: "xiesandi-finance-tracker.firebasestorage.app",
  messagingSenderId: "680812099613",
  appId: "1:680812099613:web:751d7ccab35b313b602ef4",
};

const app = initializeApp(firebaseConfig);

// Offline persistence (IndexedDB) — inilah inti offline-first-nya
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export {
  signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut,
  collection, doc, setDoc, addDoc, updateDoc, deleteDoc,
  getDoc, getDocs, query, where, orderBy, onSnapshot,
  serverTimestamp, writeBatch,
};
