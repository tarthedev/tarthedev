/**
 * Job gross profit (docs/02-commission-plan.md section 2):
 * GP = Sale − Parts and equipment − Labor − Other job costs. Can be negative.
 * Labor = each worker's clocked minutes (On My Way → Done) × burdened hourly cost,
 * rounded half-up per labor line.
 */

import { assertInt, assertNonNegativeInt, assertText } from "../internal/int";
import {
  applyBps,
  assertBps,
  assertCents,
  type Bps,
  type Cents,
  formatBps,
  formatCents,
  formatMinutes,
  mulDivHalfUp,
  sumCents,
} from "../money";

/** Default burden: wage × 1.30 (owner decision, a dated setting overridable per worker). */
export const DEFAULT_BURDEN_BPS: Bps = 13_000;

/** Burdened hourly cost = wage × burden, rounded half-up. $21.00 × 1.30 -> $27.30. */
export function burdenedRate(wageCentsPerHour: Cents, burdenBps: Bps = DEFAULT_BURDEN_BPS): Cents {
  assertNonNegativeInt(wageCentsPerHour, "wageCentsPerHour");
  assertNonNegativeInt(assertBps(burdenBps, "burdenBps"), "burdenBps");
  return applyBps(wageCentsPerHour, burdenBps);
}

/** Labor cost of one line: minutes × hourly cost ÷ 60, rounded half-up. */
export function laborCost(minutes: number, burdenedCentsPerHour: Cents): Cents {
  assertNonNegativeInt(minutes, "minutes");
  assertNonNegativeInt(burdenedCentsPerHour, "burdenedCentsPerHour");
  return mulDivHalfUp(minutes, burdenedCentsPerHour, 60);
}

export type LaborEntry = {
  workerId: string;
  /** Optional display name used in explanations. */
  workerName?: string;
  /** Clocked minutes on the job, On My Way to Done. */
  minutes: number;
  burdenedCentsPerHour: Cents;
};

export type JobGrossProfitInput = {
  /** Invoice subtotal after all discounts, excluding sales tax. */
  saleCents: Cents;
  /** Actual cost of parts and equipment used. */
  partsCents: Cents;
  labor: readonly LaborEntry[];
  /** Permits, finance and card fees, subcontractors, rentals, disposal. */
  otherCostsCents: Cents;
};

export type WorkerLabor = {
  workerId: string;
  minutes: number;
  laborCents: Cents;
};

export type JobGrossProfit = {
  gpCents: Cents;
  saleCents: Cents;
  partsCents: Cents;
  laborCents: Cents;
  otherCostsCents: Cents;
  totalCostsCents: Cents;
  /** One entry per worker (in first-seen order), summing that worker's labor lines. */
  laborByWorker: WorkerLabor[];
  explanation: string;
};

/** Computes a job's gross profit with a per-worker labor breakdown and a plain-English explanation. */
export function jobGrossProfit(input: JobGrossProfitInput): JobGrossProfit {
  const saleCents = assertCents(input.saleCents, "saleCents");
  const partsCents = assertCents(input.partsCents, "partsCents");
  const otherCostsCents = assertCents(input.otherCostsCents, "otherCostsCents");

  const byWorker = new Map<string, WorkerLabor & { names: Set<string>; detail: string[] }>();
  const lineCents: Cents[] = [];
  input.labor.forEach((entry, index) => {
    assertText(entry.workerId, `labor[${index}].workerId`);
    const cents = laborCost(entry.minutes, entry.burdenedCentsPerHour);
    lineCents.push(cents);
    let worker = byWorker.get(entry.workerId);
    if (!worker) {
      worker = {
        workerId: entry.workerId,
        minutes: 0,
        laborCents: 0,
        names: new Set(),
        detail: [],
      };
      byWorker.set(entry.workerId, worker);
    }
    worker.minutes += entry.minutes;
    worker.laborCents += cents;
    worker.names.add(entry.workerName ?? entry.workerId);
    worker.detail.push(
      `${formatMinutes(entry.minutes)} × ${formatCents(entry.burdenedCentsPerHour)}/hr = ${formatCents(cents)}`,
    );
  });

  const laborCents = sumCents(lineCents);
  const totalCostsCents = sumCents([partsCents, laborCents, otherCostsCents]);
  const gpCents = sumCents([saleCents, -totalCostsCents]);

  const laborDetail = [...byWorker.values()]
    .map((worker) => `${[...worker.names].join("/")}: ${worker.detail.join(" + ")}`)
    .join("; ");
  const explanation =
    `Sale ${formatCents(saleCents)} − parts and equipment ${formatCents(partsCents)}` +
    ` − labor ${formatCents(laborCents)} − other job costs ${formatCents(otherCostsCents)}` +
    ` = gross profit ${formatCents(gpCents)}.` +
    (laborDetail ? ` Labor: ${laborDetail}.` : " No labor was clocked.");

  return {
    gpCents,
    saleCents,
    partsCents,
    laborCents,
    otherCostsCents,
    totalCostsCents,
    laborByWorker: [...byWorker.values()].map(({ workerId, minutes, laborCents: cents }) => ({
      workerId,
      minutes,
      laborCents: cents,
    })),
    explanation,
  };
}

/** Explains a burdened rate in words: "$21.00/hr wage × 130% = $27.30/hr". */
export function explainBurdenedRate(
  wageCentsPerHour: Cents,
  burdenBps: Bps = DEFAULT_BURDEN_BPS,
): string {
  assertInt(wageCentsPerHour, "wageCentsPerHour");
  return `${formatCents(wageCentsPerHour)}/hr wage × ${formatBps(burdenBps)} = ${formatCents(
    burdenedRate(wageCentsPerHour, burdenBps),
  )}/hr burdened cost`;
}
