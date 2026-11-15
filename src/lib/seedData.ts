import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { OperationType } from '../types';
import { db, handleFirestoreError } from './firebase';

export const MAIN_ADMIN_EMAIL = 'minakhairat1@gmail.com';
export const MAIN_ADMIN_SUPERVISOR_ID = 'main_admin';
export const MAIN_ADMIN_SUPERVISOR_NAME = 'الأدمن الرئيسي';

export interface SeedLineConfig {
  id: string;
  name: string;
  maxLeaves: number;
  order: number;
  icon: string;
  sheetId: string;
}

export const INITIAL_LINES: SeedLineConfig[] = [
  { id: 'line1', name: 'خط 1', maxLeaves: 3, order: 1, icon: 'factory', sheetId: '1PotRroCGTAfYkq7igrGgvlPN944fb9gN' },
  { id: 'line2', name: 'خط 2', maxLeaves: 3, order: 2, icon: 'factory', sheetId: '1RuJnrGYiOtg8YkbUy4m_JgjctVvRnWVA' },
  { id: 'line3', name: 'خط 3', maxLeaves: 3, order: 3, icon: 'factory', sheetId: '1S2IB5ixkwWiRPvYqgr1I40SPSiX3lzOO' },
  { id: 'line4', name: 'خط 4', maxLeaves: 3, order: 4, icon: 'factory', sheetId: '1BWgw2IRoLIKrj0To-B9h0yHNrXqry-rx' },
  { id: 'microwave', name: 'خط الميكروويف', maxLeaves: 2, order: 5, icon: 'cpu', sheetId: '1-DyV02I72Lmt9q8uJHJB8g5tGCoLI6By' },
  { id: 'operations', name: 'قسم العمليات', maxLeaves: 2, order: 6, icon: 'settings', sheetId: '1x0Z8Hp3J9fK49uIzheh_Ys4z_JmTUpKX' },
  { id: 'benatat', name: 'خط البناطات', maxLeaves: 1, order: 7, icon: 'layers', sheetId: '1E6aFE-WJdqDkS9dZgbkLFRtQP2scBLlt' },
  { id: 'printing', name: 'قسم الطباعة', maxLeaves: 1, order: 8, icon: 'printer', sheetId: '1loEz_5c6hOZsPvam-ovLOQtBJZuyT6cG' },
];

// Employees extracted directly from the existing Google Sheets files
export const INITIAL_WORKERS: Array<{ id: string; employeeCode: string; name: string; lineId: string }> = [
  { id: 'w_line1_mohamed_abdelfattah', employeeCode: '1001', name: 'محمد عبد الفتاح', lineId: 'line1' },
  { id: 'w_line2_mina_shawky', employeeCode: '1002', name: 'مينا شوقي', lineId: 'line2' },
  { id: 'w_line2_islam', employeeCode: '1003', name: 'اسلام', lineId: 'line2' },
  { id: 'w_microwave_ahmed_abdelwahab', employeeCode: '1004', name: 'احمد عبد الوهاب', lineId: 'microwave' },
  { id: 'w_microwave_fady_fathy', employeeCode: '1005', name: 'فادي فتحي', lineId: 'microwave' },
  { id: 'w_microwave_ahmed_ibrahim', employeeCode: '1006', name: 'احمد محمد ابراهيم', lineId: 'microwave' },
  { id: 'w_benatat_hassan_abdelsamad', employeeCode: '1007', name: 'حسن محمد عبد الصمد', lineId: 'benatat' },
  { id: 'w_printing_reda_noshy', employeeCode: '1008', name: 'رضا نصحي', lineId: 'printing' },
];

// Historical/recorded leaves extracted directly from the existing Google Sheets files
export const INITIAL_LEAVES: Array<{
  id: string;
  lineId: string;
  lineName: string;
  date: string;
  workerId: string;
  workerCode: string;
  workerName: string;
}> = [
  {
    id: 'seed_line1_20261012_mohamed',
    lineId: 'line1',
    lineName: 'خط 1',
    date: '2026-10-12',
    workerId: 'w_line1_mohamed_abdelfattah',
    workerCode: '1001',
    workerName: 'محمد عبد الفتاح',
  },
  {
    id: 'seed_line2_20261001_mina',
    lineId: 'line2',
    lineName: 'خط 2',
    date: '2026-10-01',
    workerId: 'w_line2_mina_shawky',
    workerCode: '1002',
    workerName: 'مينا شوقي',
  },
  {
    id: 'seed_line2_20261012_islam',
    lineId: 'line2',
    lineName: 'خط 2',
    date: '2026-10-12',
    workerId: 'w_line2_islam',
    workerCode: '1003',
    workerName: 'اسلام',
  },
  {
    id: 'seed_microwave_20260129_ahmed_i',
    lineId: 'microwave',
    lineName: 'خط الميكروويف',
    date: '2026-01-29',
    workerId: 'w_microwave_ahmed_ibrahim',
    workerCode: '1006',
    workerName: 'احمد محمد ابراهيم',
  },
  {
    id: 'seed_microwave_20260210_ahmed_w',
    lineId: 'microwave',
    lineName: 'خط الميكروويف',
    date: '2026-02-10',
    workerId: 'w_microwave_ahmed_abdelwahab',
    workerCode: '1004',
    workerName: 'احمد عبد الوهاب',
  },
  {
    id: 'seed_microwave_20260211_ahmed_w',
    lineId: 'microwave',
    lineName: 'خط الميكروويف',
    date: '2026-02-11',
    workerId: 'w_microwave_ahmed_abdelwahab',
    workerCode: '1004',
    workerName: 'احمد عبد الوهاب',
  },
  {
    id: 'seed_microwave_20260214_fady',
    lineId: 'microwave',
    lineName: 'خط الميكروويف',
    date: '2026-02-14',
    workerId: 'w_microwave_fady_fathy',
    workerCode: '1005',
    workerName: 'فادي فتحي',
  },
  {
    id: 'seed_benatat_20260407_hassan',
    lineId: 'benatat',
    lineName: 'خط البناطات',
    date: '2026-04-07',
    workerId: 'w_benatat_hassan_abdelsamad',
    workerCode: '1007',
    workerName: 'حسن محمد عبد الصمد',
  },
  {
    id: 'seed_printing_20261012_reda',
    lineId: 'printing',
    lineName: 'قسم الطباعة',
    date: '2026-10-12',
    workerId: 'w_printing_reda_noshy',
    workerCode: '1008',
    workerName: 'رضا نصحي',
  },
];

export async function seedInitialDatabaseIfNeeded(adminUid: string): Promise<boolean> {
  try {
    const linesSnap = await getDocs(
      query(collection(db, 'lines'), where('isPublicSchedule', '==', true))
    );
    if (!linesSnap.empty) {
      return false;
    }

    // 1. Seed lines first
    const linesBatch = writeBatch(db);
    for (const line of INITIAL_LINES) {
      linesBatch.set(doc(db, 'lines', line.id), {
        id: line.id,
        name: line.name,
        maxLeaves: line.maxLeaves,
        order: line.order,
        icon: line.icon,
        isPublicSchedule: true,
        updatedAt: serverTimestamp(),
      });
    }
    await linesBatch.commit();

    // 2. Seed workers second
    const workersBatch = writeBatch(db);
    for (const worker of INITIAL_WORKERS) {
      workersBatch.set(doc(db, 'workers', worker.id), {
        id: worker.id,
        employeeCode: worker.employeeCode,
        name: worker.name,
        lineId: worker.lineId,
        supervisorId: MAIN_ADMIN_SUPERVISOR_ID,
        supervisorName: MAIN_ADMIN_SUPERVISOR_NAME,
        supervisorUid: adminUid,
        claimedUid: '',
        active: true,
        isTeamDirectory: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await workersBatch.commit();

    // 3. Seed leaves in chunks of 8 to respect Firestore rules lookup limits per batch
    for (let i = 0; i < INITIAL_LEAVES.length; i += 8) {
      const chunk = INITIAL_LEAVES.slice(i, i + 8);
      const leavesBatch = writeBatch(db);
      for (const leave of chunk) {
        leavesBatch.set(doc(db, 'leaves', leave.id), {
          id: leave.id,
          lineId: leave.lineId,
          lineName: leave.lineName,
          date: leave.date,
          workerId: leave.workerId,
          workerCode: leave.workerCode,
          workerName: leave.workerName,
          workerUid: '',
          supervisorId: MAIN_ADMIN_SUPERVISOR_ID,
          approvedByUid: adminUid,
          source: 'seed',
          isPublicSchedule: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await leavesBatch.commit();
    }

    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'lines/workers/leaves');
  }
}

function parseSheetDateToISO(raw: string): string | null {
  const cleaned = raw.trim();
  const ymd = cleaned.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (ymd) {
    const [, y, m, d] = ymd;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const dmy = cleaned.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

function makeWorkerSlug(lineId: string, name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return `w_${lineId}_${hash.toString(36)}`;
}

export async function importFromLegacyGoogleSheets(adminUid: string): Promise<{
  addedWorkers: number;
  addedLeaves: number;
}> {
  try {
    await seedInitialDatabaseIfNeeded(adminUid);

    const [existingWorkersSnap, existingLeavesSnap] = await Promise.all([
      getDocs(query(collection(db, 'workers'), where('isTeamDirectory', '==', true))),
      getDocs(query(collection(db, 'leaves'), where('isPublicSchedule', '==', true))),
    ]);

    const workerByNameAndLine = new Map<
      string,
      { id: string; employeeCode: string; supervisorId: string; claimedUid: string }
    >();
    existingWorkersSnap.forEach((docSnap) => {
      const data = docSnap.data();
      workerByNameAndLine.set(`${data.lineId}::${String(data.name).trim()}`, {
        id: docSnap.id,
        employeeCode: String(data.employeeCode || `EMP-${docSnap.id.slice(-4).toUpperCase()}`),
        supervisorId: data.supervisorId || MAIN_ADMIN_SUPERVISOR_ID,
        claimedUid: data.claimedUid || '',
      });
    });

    const existingLeaveKeys = new Set<string>();
    existingLeavesSnap.forEach((docSnap) => {
      const data = docSnap.data();
      existingLeaveKeys.add(`${data.lineId}::${data.date}::${String(data.workerName).trim()}`);
    });

    const workersToCreate: Array<{ id: string; employeeCode: string; name: string; lineId: string }> = [];
    const leavesToCreate: Array<{
      id: string;
      lineId: string;
      lineName: string;
      date: string;
      workerId: string;
      workerCode: string;
      workerName: string;
      workerUid: string;
      supervisorId: string;
    }> = [];

    for (const line of INITIAL_LINES) {
      const url = `https://docs.google.com/spreadsheets/d/${line.sheetId}/gviz/tq?tqx=out:csv&gid=0`;
      const response = await fetch(url);
      if (!response.ok) continue;
      const csvText = await response.text();
      const rows = csvText
        .split('\n')
        .map((r) => r.trim())
        .filter(Boolean);

      if (rows.length < 2) continue;

      for (let i = 1; i < rows.length; i++) {
        const cols = (rows[i].match(/(?:[^,"]+|"[^"]*")+/g) || []).map((c) =>
          c.replace(/^"|"$/g, '').trim()
        );
        const dateISO = parseSheetDateToISO(cols[0] || '');
        if (!dateISO) continue;

        for (let c = 1; c < cols.length; c++) {
          const workerName = cols[c]?.trim();
          if (!workerName) continue;

          const workerKey = `${line.id}::${workerName}`;
          let workerInfo = workerByNameAndLine.get(workerKey);
          if (!workerInfo) {
            const newWorkerId = makeWorkerSlug(line.id, workerName);
            const fallbackCode = `SH-${newWorkerId.slice(-5).toUpperCase()}`;
            workerInfo = {
              id: newWorkerId,
              employeeCode: fallbackCode,
              supervisorId: MAIN_ADMIN_SUPERVISOR_ID,
              claimedUid: '',
            };
            workerByNameAndLine.set(workerKey, workerInfo);
            workersToCreate.push({
              id: newWorkerId,
              employeeCode: fallbackCode,
              name: workerName.slice(0, 100),
              lineId: line.id,
            });
          }

          const leaveKey = `${line.id}::${dateISO}::${workerName}`;
          if (!existingLeaveKeys.has(leaveKey)) {
            existingLeaveKeys.add(leaveKey);
            const leaveId = `sheet_${line.id}_${dateISO.replace(/-/g, '')}_${workerInfo.id}`;
            leavesToCreate.push({
              id: leaveId,
              lineId: line.id,
              lineName: line.name,
              date: dateISO,
              workerId: workerInfo.id,
              workerCode: workerInfo.employeeCode,
              workerName: workerName.slice(0, 100),
              workerUid: workerInfo.claimedUid,
              supervisorId: workerInfo.supervisorId,
            });
          }
        }
      }
    }

    for (let i = 0; i < workersToCreate.length; i += 8) {
      const chunk = workersToCreate.slice(i, i + 8);
      const batch = writeBatch(db);
      for (const w of chunk) {
        batch.set(doc(db, 'workers', w.id), {
          id: w.id,
          employeeCode: w.employeeCode,
          name: w.name,
          lineId: w.lineId,
          supervisorId: MAIN_ADMIN_SUPERVISOR_ID,
          supervisorName: MAIN_ADMIN_SUPERVISOR_NAME,
          supervisorUid: adminUid,
          claimedUid: '',
          active: true,
          isTeamDirectory: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }

    for (let i = 0; i < leavesToCreate.length; i += 8) {
      const chunk = leavesToCreate.slice(i, i + 8);
      const batch = writeBatch(db);
      for (const l of chunk) {
        batch.set(doc(db, 'leaves', l.id), {
          id: l.id,
          lineId: l.lineId,
          lineName: l.lineName,
          date: l.date,
          workerId: l.workerId,
          workerCode: l.workerCode,
          workerName: l.workerName,
          workerUid: l.workerUid,
          supervisorId: l.supervisorId,
          approvedByUid: adminUid,
          source: 'seed',
          isPublicSchedule: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }

    return {
      addedWorkers: workersToCreate.length,
      addedLeaves: leavesToCreate.length,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'legacy_import');
  }
}
