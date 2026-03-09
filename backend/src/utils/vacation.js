const { formatDate, dayjs, parseDateInput, todayUtc } = require("./date");

function getPeriodAnchor(employee, periodNumber) {
  if (
    employee.cycleStartDate &&
    typeof employee.cycleStartPeriod === "number" &&
    periodNumber >= employee.cycleStartPeriod
  ) {
    const anchor = dayjs.utc(employee.cycleStartDate).startOf("day");
    return anchor.add(periodNumber - employee.cycleStartPeriod, "year");
  }

  const hire = dayjs.utc(employee.hireDate).startOf("day");
  return hire.add(periodNumber, "year");
}

function buildBasePeriod(employee, periodNumber) {
  const acquisitionStart = getPeriodAnchor(employee, periodNumber);
  const acquisitionEnd = acquisitionStart.add(1, "year").subtract(1, "day");
  const concessionStart = acquisitionEnd.add(1, "day");
  const concessionEnd = acquisitionEnd.add(11, "month");
  const dueDate = concessionEnd;

  return {
    acquisitionStart,
    acquisitionEnd,
    concessionStart,
    concessionEnd,
    dueDate,
  };
}

function getEffectivePeriodDates(employee, period) {
  const base = buildBasePeriod(employee, period.periodNumber);

  return {
    acquisitionStart: period.overrideAcquisitionStart
      ? dayjs.utc(period.overrideAcquisitionStart)
      : base.acquisitionStart,
    acquisitionEnd: period.overrideAcquisitionEnd
      ? dayjs.utc(period.overrideAcquisitionEnd)
      : base.acquisitionEnd,
    concessionStart: period.overrideConcessionStart
      ? dayjs.utc(period.overrideConcessionStart)
      : base.concessionStart,
    concessionEnd: period.overrideConcessionEnd
      ? dayjs.utc(period.overrideConcessionEnd)
      : base.concessionEnd,
    dueDate: period.overrideDueDate ? dayjs.utc(period.overrideDueDate) : base.dueDate,
  };
}

function getEligiblePeriodCount(hireDate, referenceDate = todayUtc()) {
  const hire = dayjs.utc(hireDate).startOf("day");
  let count = 0;

  while (true) {
    const acquisitionEnd = hire.add(count + 1, "year").subtract(1, "day");
    if (acquisitionEnd.isAfter(referenceDate)) {
      break;
    }
    count += 1;
  }

  return count;
}

async function syncEmployeePeriods(prisma, employee) {
  const eligibleCount = getEligiblePeriodCount(employee.hireDate);
  const existing = await prisma.vacationPeriod.findMany({
    where: { employeeId: employee.id },
    select: { id: true, periodNumber: true, manuallyGranted: true, _count: { select: { blocks: true } } },
  });

  const existingNumbers = new Set(existing.map((period) => period.periodNumber));
  const createOps = [];

  for (let periodNumber = 0; periodNumber < eligibleCount; periodNumber += 1) {
    if (!existingNumbers.has(periodNumber)) {
      createOps.push(
        prisma.vacationPeriod.create({
          data: {
            employeeId: employee.id,
            periodNumber,
          },
        })
      );
    }
  }

  const removableIds = existing
    .filter(
      (period) =>
        period.periodNumber >= eligibleCount &&
        !period.manuallyGranted &&
        period._count.blocks === 0
    )
    .map((period) => period.id);

  if (createOps.length) {
    await prisma.$transaction(createOps);
  }

  if (removableIds.length) {
    await prisma.vacationPeriod.deleteMany({
      where: { id: { in: removableIds } },
    });
  }
}

function getUsedDays(period) {
  return period.importedUsedDays + period.blocks.reduce((sum, block) => sum + block.days, 0);
}

function getRemainingDays(period) {
  if (period.manuallyGranted) return 0;
  return Math.max(period.totalDays - getUsedDays(period), 0);
}

function getUrgency(dueDate) {
  const today = todayUtc();
  const due = dayjs.utc(dueDate).startOf("day");

  if (due.isBefore(today) || due.isSame(today, "day")) return "OVERDUE";
  if (due.isBefore(today.add(2, "month")) || due.isSame(today.add(2, "month"), "day")) return "DUE_2";
  if (due.isBefore(today.add(3, "month"))) return "DUE_3";
  if (due.isBefore(today.add(4, "month"))) return "DUE_4";
  if (due.isBefore(today.add(5, "month"))) return "DUE_5";
  return "NORMAL";
}

function serializeVacationPeriod(employee, period) {
  const effective = getEffectivePeriodDates(employee, period);
  const usedDays = getUsedDays(period);
  const remainingDays = getRemainingDays(period);
  const granted = period.manuallyGranted || remainingDays === 0;

  return {
    id: period.id,
    employeeId: employee.id,
    employeeName: employee.name,
    employeeCode: employee.code,
    hireDate: formatDate(employee.hireDate),
    companyId: employee.companyId,
    companyName: employee.company?.name,
    periodNumber: period.periodNumber,
    totalDays: period.totalDays,
    importedUsedDays: period.importedUsedDays,
    usedDays,
    remainingDays,
    manuallyGranted: period.manuallyGranted,
    isAway: period.isAway,
    granted,
    notes: period.notes || "",
    urgency: getUrgency(effective.dueDate),
    acquisitionStart: formatDate(effective.acquisitionStart),
    acquisitionEnd: formatDate(effective.acquisitionEnd),
    concessionStart: formatDate(effective.concessionStart),
    concessionEnd: formatDate(effective.concessionEnd),
    dueDate: formatDate(effective.dueDate),
    blocks: period.blocks
      .slice()
      .sort((a, b) => Number(new Date(a.startDate || a.createdAt)) - Number(new Date(b.startDate || b.createdAt)))
      .map((block) => ({
        id: block.id,
        startDate: formatDate(block.startDate),
        endDate: formatDate(block.endDate),
        days: block.days,
        notes: block.notes || "",
        createdAt: block.createdAt,
      })),
  };
}

function parseOptionalDate(value) {
  return value ? parseDateInput(value) : null;
}

function getPeriodNumberFromDate(hireDate, acquisitionStartDate) {
  const hire = dayjs.utc(hireDate).startOf("day");
  const start = dayjs.utc(acquisitionStartDate).startOf("day");
  let periodNumber = start.year() - hire.year();

  if (start.month() < hire.month() || (start.month() === hire.month() && start.date() < hire.date())) {
    periodNumber -= 1;
  }

  return Math.max(periodNumber, 0);
}

function calculateBlockDays(startDate, endDate) {
  const start = dayjs.utc(startDate).startOf("day");
  const end = dayjs.utc(endDate).startOf("day");

  if (end.isBefore(start)) {
    throw new Error("A data final nao pode ser menor que a data inicial.");
  }

  return end.diff(start, "day") + 1;
}

module.exports = {
  buildBasePeriod,
  calculateBlockDays,
  getEffectivePeriodDates,
  getEligiblePeriodCount,
  getPeriodNumberFromDate,
  getRemainingDays,
  getUsedDays,
  getUrgency,
  parseOptionalDate,
  serializeVacationPeriod,
  syncEmployeePeriods,
};
