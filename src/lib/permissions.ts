import { ProductionLine, Supervisor, Worker } from '../types';

export function getSupervisorAllowedLines(
  lines: ProductionLine[],
  isMainAdmin: boolean,
  supervisorRecord: Supervisor | null
): ProductionLine[] {
  if (isMainAdmin) return lines;
  if (!supervisorRecord || !supervisorRecord.active) return [];
  if (supervisorRecord.canManageTeam || supervisorRecord.isAssistantAdmin) return lines;
  const allowed = supervisorRecord.allowedLineIds || [];
  return lines.filter((l) => allowed.includes(l.id));
}

export function canSupervisorControlLine(
  lineId: string,
  isMainAdmin: boolean,
  supervisorRecord: Supervisor | null
): boolean {
  if (isMainAdmin) return true;
  if (!supervisorRecord || !supervisorRecord.active) return false;
  if (supervisorRecord.canManageTeam || supervisorRecord.isAssistantAdmin) return true;
  return (supervisorRecord.allowedLineIds || []).includes(lineId);
}

export function canSupervisorControlWorker(
  worker: Worker,
  isMainAdmin: boolean,
  supervisorRecord: Supervisor | null
): boolean {
  if (isMainAdmin) return true;
  if (!supervisorRecord || !supervisorRecord.active) return false;
  if (supervisorRecord.canManageTeam || supervisorRecord.isAssistantAdmin) return true;
  if (worker.supervisorId === supervisorRecord.id) return true;
  return (supervisorRecord.allowedLineIds || []).includes(worker.lineId);
}
