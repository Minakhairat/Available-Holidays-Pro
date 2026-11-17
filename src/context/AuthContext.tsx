import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError } from '../lib/firebase';
import { MAIN_ADMIN_EMAIL, seedInitialDatabaseIfNeeded } from '../lib/seedData';
import { OperationType, Supervisor, UserProfile } from '../types';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  supervisorRecord: Supervisor | null;
  isMainAdmin: boolean;
  isSupervisor: boolean;
  authReady: boolean;
  signingIn: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshAuthContext: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [supervisorRecord, setSupervisorRecord] = useState<Supervisor | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const isMainAdmin =
    Boolean(user?.emailVerified) &&
    user?.email?.toLowerCase() === MAIN_ADMIN_EMAIL.toLowerCase();

  const isSupervisor = Boolean(supervisorRecord?.active);

  const syncSignedInUser = async (firebaseUser: User) => {
    const email = (firebaseUser.email || '').toLowerCase();
    const displayName = (firebaseUser.displayName || email.split('@')[0] || 'مستخدم').slice(
      0,
      100
    );

    // 1. Ensure user_profiles/{uid} exists
    const profileRef = doc(db, 'user_profiles', firebaseUser.uid);
    let currentProfile: UserProfile;

    try {
      const profileSnap = await getDoc(profileRef);
      if (!profileSnap.exists()) {
        currentProfile = {
          uid: firebaseUser.uid,
          email,
          displayName,
          workerId: '',
        };
        await setDoc(profileRef, {
          ...currentProfile,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        currentProfile = profileSnap.data() as UserProfile;
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `user_profiles/${firebaseUser.uid}`);
    }

    // 2. If Main Admin, automatically seed initial Excel/Sheets data if database is empty
    if (firebaseUser.emailVerified && email === MAIN_ADMIN_EMAIL.toLowerCase()) {
      await seedInitialDatabaseIfNeeded(firebaseUser.uid);
    }

    // 3. Check if user is an active Sub-Admin / Supervisor by email
    let activeSupervisor: Supervisor | null = null;
    try {
      const supQuery = query(collection(db, 'supervisors'), where('email', '==', email));
      const supSnap = await getDocs(supQuery);
      if (!supSnap.empty) {
        const supDoc = supSnap.docs[0];
        const supData = supDoc.data() as Supervisor;
        if (supData.active) {
          // Bind UID onto supervisor doc if empty
          if (!supData.uid) {
            await updateDoc(supDoc.ref, {
              uid: firebaseUser.uid,
              updatedAt: serverTimestamp(),
            });
            supData.uid = firebaseUser.uid;
          }

          // Bind supervisor_accounts/{uid} for fast security rules lookup
          const supAccRef = doc(db, 'supervisor_accounts', firebaseUser.uid);
          const supAccSnap = await getDoc(supAccRef);
          if (!supAccSnap.exists()) {
            await setDoc(supAccRef, {
              uid: firebaseUser.uid,
              supervisorId: supData.id,
              email,
              createdAt: serverTimestamp(),
            });
          }

          // Ensure all assigned workers carry this supervisor's UID
          const assignedWorkersSnap = await getDocs(
            query(
              collection(db, 'workers'),
              where('isTeamDirectory', '==', true),
              where('supervisorId', '==', supData.id)
            )
          );
          const missingUidWorkers = assignedWorkersSnap.docs.filter(
            (w) => w.data().supervisorUid !== firebaseUser.uid
          );
          if (missingUidWorkers.length > 0) {
            const batch = writeBatch(db);
            missingUidWorkers.forEach((w) => {
              batch.update(w.ref, {
                supervisorUid: firebaseUser.uid,
                updatedAt: serverTimestamp(),
              });
            });
            await batch.commit();
          }

          activeSupervisor = supData;
        }
      }
    } catch (error) {
      console.error('Supervisor sync notice:', error);
    }

    // 4. Auto-match worker_pii by email if user doesn't have a workerId yet
    if (!currentProfile.workerId && email) {
      try {
        const piiSnap = await getDocs(
          query(collection(db, 'worker_pii'), where('email', '==', email))
        );
        const unclaimedPiiDoc = piiSnap.docs.find((d) => !d.data().claimedUid);
        if (unclaimedPiiDoc) {
          const workerId = unclaimedPiiDoc.data().workerId as string;
          const workerSnap = await getDoc(doc(db, 'workers', workerId));
          if (workerSnap.exists() && !workerSnap.data().claimedUid) {
            const batch = writeBatch(db);
            batch.update(workerSnap.ref, {
              claimedUid: firebaseUser.uid,
              updatedAt: serverTimestamp(),
            });
            batch.update(unclaimedPiiDoc.ref, {
              claimedUid: firebaseUser.uid,
              updatedAt: serverTimestamp(),
            });
            batch.update(profileRef, {
              workerId,
              updatedAt: serverTimestamp(),
            });
            await batch.commit();
            currentProfile = { ...currentProfile, workerId };
          }
        }
      } catch (error) {
        console.error('Worker PII matching notice:', error);
      }
    }

    setProfile(currentProfile);
    setSupervisorRecord(activeSupervisor);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          await syncSignedInUser(firebaseUser);
        } catch (err) {
          console.error('Failed syncing signed in user:', err);
        }
      } else {
        setProfile(null);
        setSupervisorRecord(null);
      }
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'تعذر تسجيل الدخول بحساب Google';
      setAuthError(message);
    } finally {
      setSigningIn(false);
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
  };

  const refreshAuthContext = async () => {
    if (auth.currentUser) {
      await syncSignedInUser(auth.currentUser);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        supervisorRecord,
        isMainAdmin,
        isSupervisor,
        authReady,
        signingIn,
        authError,
        signInWithGoogle,
        signOut,
        refreshAuthContext,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
