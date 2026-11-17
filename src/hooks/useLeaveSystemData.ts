import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import {
  AppNotification,
  LeaveEntry,
  LeaveRequest,
  OperationType,
  ProductionLine,
  Supervisor,
  SwapRequest,
  UserProfile,
  Worker,
  WorkerLinkRequest,
  WorkerLinkRequestStatus,
  WorkerPii,
} from '../types';

function sortByCreatedDesc<T extends { createdAt?: { toMillis?: () => number } }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
    const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
    return tb - ta;
  });
}

export function useLeaveSystemData() {
  const { user, supervisorRecord, isMainAdmin, isSupervisor, authReady } = useAuth();

  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [leaves, setLeaves] = useState<LeaveEntry[]>([]);
  const [supervisors, setSupervisors] = useState<Supervisor[]>([]);
  const [workerPiiList, setWorkerPiiList] = useState<WorkerPii[]>([]);
  const [userProfiles, setUserProfiles] = useState<UserProfile[]>([]);
  const [workerLinkRequests, setWorkerLinkRequests] = useState<WorkerLinkRequest[]>([]);

  const [myLeaveReqs, setMyLeaveReqs] = useState<LeaveRequest[]>([]);
  const [supLeaveReqs, setSupLeaveReqs] = useState<LeaveRequest[]>([]);
  const [supLineLeaveReqs, setSupLineLeaveReqs] = useState<Record<string, LeaveRequest[]>>({});

  const [fromSwaps, setFromSwaps] = useState<SwapRequest[]>([]);
  const [toSwaps, setToSwaps] = useState<SwapRequest[]>([]);
  const [supFromSwaps, setSupFromSwaps] = useState<SwapRequest[]>([]);
  const [supToSwaps, setSupToSwaps] = useState<SwapRequest[]>([]);
  const [supLineSwaps, setSupLineSwaps] = useState<Record<string, SwapRequest[]>>({});

  const [userNotifs, setUserNotifs] = useState<AppNotification[]>([]);
  const [adminNotifs, setAdminNotifs] = useState<AppNotification[]>([]);
  const [supNotifs, setSupNotifs] = useState<AppNotification[]>([]);

  const [loading, setLoading] = useState(true);

  const supCanManageTeam = Boolean(isSupervisor && supervisorRecord?.canManageTeam);
  const supAllowedLineIdsKey = (supervisorRecord?.allowedLineIds || []).join(',');

  useEffect(() => {
    if (!authReady || !user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubs: Array<() => void> = [];
    const allowedLineIds = supAllowedLineIdsKey
      ? supAllowedLineIdsKey.split(',').filter(Boolean)
      : [];

    // 1. Production Lines
    unsubs.push(
      onSnapshot(
        query(collection(db, 'lines'), where('isPublicSchedule', '==', true)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as ProductionLine);
          list.sort((a, b) => a.order - b.order);
          setLines(list);
          setLoading(false);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'lines')
      )
    );

    // 2. Workers directory (non-PII)
    unsubs.push(
      onSnapshot(
        query(collection(db, 'workers'), where('isTeamDirectory', '==', true)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as Worker);
          list.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
          setWorkers(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'workers')
      )
    );

    // 3. Approved Leaves
    unsubs.push(
      onSnapshot(
        query(collection(db, 'leaves'), where('isPublicSchedule', '==', true)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as LeaveEntry);
          setLeaves(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'leaves')
      )
    );

    // 4. Leave Requests
    setSupLineLeaveReqs({});
    if (isMainAdmin || supCanManageTeam) {
      unsubs.push(
        onSnapshot(
          collection(db, 'leave_requests'),
          (snap) => {
            setMyLeaveReqs(snap.docs.map((d) => d.data() as LeaveRequest));
            setSupLeaveReqs([]);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'leave_requests')
        )
      );
    } else {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'leave_requests'), where('requesterUid', '==', user.uid)),
          (snap) => setMyLeaveReqs(snap.docs.map((d) => d.data() as LeaveRequest)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'leave_requests')
        )
      );
      if (isSupervisor) {
        unsubs.push(
          onSnapshot(
            query(collection(db, 'leave_requests'), where('supervisorUid', '==', user.uid)),
            (snap) => setSupLeaveReqs(snap.docs.map((d) => d.data() as LeaveRequest)),
            (err) => handleFirestoreError(err, OperationType.LIST, 'leave_requests')
          )
        );
        for (let i = 0; i < allowedLineIds.length; i += 10) {
          const chunk = allowedLineIds.slice(i, i + 10);
          const chunkKey = `chunk_${i}`;
          unsubs.push(
            onSnapshot(
              query(collection(db, 'leave_requests'), where('lineId', 'in', chunk)),
              (snap) =>
                setSupLineLeaveReqs((prev) => ({
                  ...prev,
                  [chunkKey]: snap.docs.map((d) => d.data() as LeaveRequest),
                })),
              (err) => handleFirestoreError(err, OperationType.LIST, 'leave_requests')
            )
          );
        }
      } else {
        setSupLeaveReqs([]);
      }
    }

    // 5. Swap Requests
    setSupLineSwaps({});
    if (isMainAdmin || supCanManageTeam) {
      unsubs.push(
        onSnapshot(
          collection(db, 'swap_requests'),
          (snap) => {
            setFromSwaps(snap.docs.map((d) => d.data() as SwapRequest));
            setToSwaps([]);
            setSupFromSwaps([]);
            setSupToSwaps([]);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'swap_requests')
        )
      );
    } else {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'swap_requests'), where('fromUid', '==', user.uid)),
          (snap) => setFromSwaps(snap.docs.map((d) => d.data() as SwapRequest)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'swap_requests')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'swap_requests'), where('toUid', '==', user.uid)),
          (snap) => setToSwaps(snap.docs.map((d) => d.data() as SwapRequest)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'swap_requests')
        )
      );
      if (isSupervisor) {
        unsubs.push(
          onSnapshot(
            query(collection(db, 'swap_requests'), where('fromSupervisorUid', '==', user.uid)),
            (snap) => setSupFromSwaps(snap.docs.map((d) => d.data() as SwapRequest)),
            (err) => handleFirestoreError(err, OperationType.LIST, 'swap_requests')
          )
        );
        unsubs.push(
          onSnapshot(
            query(collection(db, 'swap_requests'), where('toSupervisorUid', '==', user.uid)),
            (snap) => setSupToSwaps(snap.docs.map((d) => d.data() as SwapRequest)),
            (err) => handleFirestoreError(err, OperationType.LIST, 'swap_requests')
          )
        );
        for (let i = 0; i < allowedLineIds.length; i += 10) {
          const chunk = allowedLineIds.slice(i, i + 10);
          const chunkKey = `chunk_${i}`;
          unsubs.push(
            onSnapshot(
              query(collection(db, 'swap_requests'), where('lineId', 'in', chunk)),
              (snap) =>
                setSupLineSwaps((prev) => ({
                  ...prev,
                  [chunkKey]: snap.docs.map((d) => d.data() as SwapRequest),
                })),
              (err) => handleFirestoreError(err, OperationType.LIST, 'swap_requests')
            )
          );
        }
      } else {
        setSupFromSwaps([]);
        setSupToSwaps([]);
      }
    }

    // 6. Notifications
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'notifications'),
          where('recipientRole', '==', 'user'),
          where('recipientUid', '==', user.uid)
        ),
        (snap) => setUserNotifs(snap.docs.map((d) => d.data() as AppNotification)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
      )
    );

    if (isMainAdmin) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'notifications'), where('recipientRole', '==', 'admin')),
          (snap) => setAdminNotifs(snap.docs.map((d) => d.data() as AppNotification)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
        )
      );
    } else {
      setAdminNotifs([]);
    }

    if (isSupervisor) {
      unsubs.push(
        onSnapshot(
          query(
            collection(db, 'notifications'),
            where('recipientRole', '==', 'supervisor'),
            where('recipientSupervisorUid', '==', user.uid)
          ),
          (snap) => setSupNotifs(snap.docs.map((d) => d.data() as AppNotification)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
        )
      );
    } else {
      setSupNotifs([]);
    }

    // 7. Supervisors, Worker PII, & User Profiles (Main Admin)
    if (isMainAdmin) {
      unsubs.push(
        onSnapshot(
          collection(db, 'supervisors'),
          (snap) => setSupervisors(sortByCreatedDesc(snap.docs.map((d) => d.data() as Supervisor))),
          (err) => handleFirestoreError(err, OperationType.LIST, 'supervisors')
        )
      );
      unsubs.push(
        onSnapshot(
          collection(db, 'worker_pii'),
          (snap) => setWorkerPiiList(snap.docs.map((d) => d.data() as WorkerPii)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'worker_pii')
        )
      );
      unsubs.push(
        onSnapshot(
          collection(db, 'user_profiles'),
          (snap) =>
            setUserProfiles(sortByCreatedDesc(snap.docs.map((d) => d.data() as UserProfile))),
          (err) => handleFirestoreError(err, OperationType.LIST, 'user_profiles')
        )
      );
      unsubs.push(
        onSnapshot(
          collection(db, 'worker_link_requests'),
          (snap) =>
            setWorkerLinkRequests(
              sortByCreatedDesc(snap.docs.map((d) => d.data() as WorkerLinkRequest))
            ),
          (err) => handleFirestoreError(err, OperationType.LIST, 'worker_link_requests')
        )
      );
    } else {
      setSupervisors([]);
      setUserProfiles([]);
      unsubs.push(
        onSnapshot(
          query(collection(db, 'worker_pii'), where('claimedUid', '==', user.uid)),
          (snap) => setWorkerPiiList(snap.docs.map((d) => d.data() as WorkerPii)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'worker_pii')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'worker_link_requests'), where('requesterUid', '==', user.uid)),
          (snap) =>
            setWorkerLinkRequests(
              sortByCreatedDesc(snap.docs.map((d) => d.data() as WorkerLinkRequest))
            ),
          (err) => handleFirestoreError(err, OperationType.LIST, 'worker_link_requests')
        )
      );
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [authReady, user, isMainAdmin, isSupervisor, supCanManageTeam, supAllowedLineIdsKey]);

  const leaveRequests = useMemo(() => {
    const map = new Map<string, LeaveRequest>();
    [...myLeaveReqs, ...supLeaveReqs, ...Object.values(supLineLeaveReqs).flat()].forEach((r) =>
      map.set(r.id, r)
    );
    return sortByCreatedDesc(Array.from(map.values()));
  }, [myLeaveReqs, supLeaveReqs, supLineLeaveReqs]);

  const swapRequests = useMemo(() => {
    const map = new Map<string, SwapRequest>();
    [
      ...fromSwaps,
      ...toSwaps,
      ...supFromSwaps,
      ...supToSwaps,
      ...Object.values(supLineSwaps).flat(),
    ].forEach((s) => map.set(s.id, s));
    return sortByCreatedDesc(Array.from(map.values()));
  }, [fromSwaps, toSwaps, supFromSwaps, supToSwaps, supLineSwaps]);

  const notifications = useMemo(() => {
    const map = new Map<string, AppNotification>();
    [...userNotifs, ...adminNotifs, ...supNotifs].forEach((n) => map.set(n.id, n));
    return sortByCreatedDesc(Array.from(map.values()));
  }, [userNotifs, adminNotifs, supNotifs]);

  const workerPiiByWorkerId = useMemo(() => {
    const map = new Map<string, WorkerPii>();
    workerPiiList.forEach((p) => map.set(p.workerId, p));
    return map;
  }, [workerPiiList]);

  const userProfilesByUid = useMemo(() => {
    const map = new Map<string, UserProfile>();
    userProfiles.forEach((u) => map.set(u.uid, u));
    return map;
  }, [userProfiles]);

  const currentWorker = useMemo(() => {
    if (!user) return null;
    return workers.find((w) => w.claimedUid === user.uid) || null;
  }, [user, workers]);

  const myPendingLinkRequest = useMemo(() => {
    if (!user) return null;
    return (
      workerLinkRequests.find(
        (r) => r.requesterUid === user.uid && r.status === WorkerLinkRequestStatus.PENDING
      ) || null
    );
  }, [user, workerLinkRequests]);

  const myLatestLinkRequest = useMemo(() => {
    if (!user) return null;
    return workerLinkRequests.find((r) => r.requesterUid === user.uid) || null;
  }, [user, workerLinkRequests]);

  return {
    lines,
    workers,
    leaves,
    supervisors,
    workerPiiList,
    workerPiiByWorkerId,
    userProfiles,
    userProfilesByUid,
    workerLinkRequests,
    myPendingLinkRequest,
    myLatestLinkRequest,
    leaveRequests,
    swapRequests,
    notifications,
    currentWorker,
    loading,
  };
}
