const express = require("express");
const { z } = require("zod");

const prisma = require("../db");
const { authRequired } = require("../middleware");
const { dayjs, parseDateInput, formatDate } = require("../utils/date");
const {
  calculateBlockDays,
  getEffectivePeriodDates,
  getPeriodNumberFromDate,
  parseOptionalDate,
  serializeVacationPeriod,
  syncEmployeePeriods,
} = require("../utils/vacation");
const { writeAuditLog } = require("../services/audit");

const router = express.Router();

const employeeSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(1),
  jobTitle: z.string().min(1),
  companyId: z.coerce.number().int().positive(),
  hireDate: z.string().min(10),
});

const employeeUpdateSchema = employeeSchema.partial().extend({
  active: z.boolean().optional(),
});

const periodSchema = z.object({
  totalDays: z.coerce.number().int().min(1).max(120).optional(),
  importedUsedDays: z.coerce.number().int().min(0).max(120).optional(),
  manuallyGranted: z.boolean().optional(),
  isAway: z.boolean().optional(),
  notes: z.string().max(500).optional(),
  acquisitionStart: z.string().optional().nullable(),
  acquisitionEnd: z.string().optional().nullable(),
  concessionStart: z.string().optional().nullable(),
  concessionEnd: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
});

const cycleSchema = z.object({
  startPeriodId: z.coerce.number().int().positive(),
  anchorDay: z.coerce.number().int().min(1).max(31),
  anchorMonth: z.coerce.number().int().min(1).max(12),
});

const blockSchema = z.object({
  startDate: z.string().min(10),
  endDate: z.string().min(10),
  notes: z.string().max(500).optional(),
});

router.use(authRequired);

function buildEmployeeFilters({ includeInactive, search, companyId }) {
  return {
    ...(includeInactive ? {} : { active: true }),
    ...(companyId ? { companyId } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { code: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

async function findActiveCodeConflict({ employeeId, code, companyId }) {
  if (!code || !companyId) return null;

  return prisma.employee.findFirst({
    where: {
      code,
      companyId,
      active: true,
      ...(employeeId ? { id: { not: employeeId } } : {}),
    },
    select: {
      id: true,
      name: true,
      code: true,
    },
  });
}

function isAwayUnlockOnly(payload) {
  const keys = Object.keys(payload).filter((key) => payload[key] !== undefined);
  return keys.length === 1 && keys[0] === "isAway" && payload.isAway === false;
}

function describePeriod(periodNumber) {
  return `Periodo #${periodNumber + 1}`;
}

router.get("/", async (req, res) => {
  const includeInactive = req.query.includeInactive === "true";
  const search = String(req.query.search || "").trim();
  const companyId = req.query.companyId ? Number(req.query.companyId) : null;
  const filters = buildEmployeeFilters({ includeInactive, search, companyId });

  const employees = await prisma.employee.findMany({
    where: filters,
    include: {
      company: true,
      periods: {
        include: { blocks: true },
        orderBy: { periodNumber: "asc" },
      },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  for (const employee of employees) {
    await syncEmployeePeriods(prisma, employee);
  }

  const refreshed = await prisma.employee.findMany({
    where: filters,
    include: {
      company: true,
      periods: {
        include: { blocks: true },
        orderBy: { periodNumber: "asc" },
      },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  const items = refreshed.map((employee) => ({
    id: employee.id,
    name: employee.name,
    code: employee.code,
    active: employee.active,
    hireDate: formatDate(employee.hireDate),
    companyId: employee.companyId,
    companyName: employee.company.name,
    openPeriods: employee.periods
      .map((period) => serializeVacationPeriod(employee, period))
      .filter((period) => !period.granted).length,
  }));

  return res.json({ employees: items });
});

router.post("/", async (req, res) => {
  const parsed = employeeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados do funcionario invalidos." });
  }

  const normalizedCode = parsed.data.code.trim();
  const conflict = await findActiveCodeConflict({
    code: normalizedCode,
    companyId: parsed.data.companyId,
  });
  if (conflict) {
    return res.status(409).json({ message: "Erro: Ja existe um funcionario com esse codigo nesta empresa." });
  }

  const employee = await prisma.employee.create({
    data: {
      name: parsed.data.name.trim(),
      code: normalizedCode,
      jobTitle: parsed.data.jobTitle.trim(),
      companyId: parsed.data.companyId,
      hireDate: parseDateInput(parsed.data.hireDate),
    },
    include: { company: true },
  });

  await syncEmployeePeriods(prisma, employee);

  await writeAuditLog(prisma, {
    user: req.user,
    action: "CREATE_EMPLOYEE",
    entityType: "EMPLOYEE",
    entityId: employee.id,
    description: `Criou o funcionario ${employee.name} (${employee.code}) na empresa ${employee.company.name}.`,
  });

  return res.status(201).json({
    employee: {
      id: employee.id,
      name: employee.name,
      code: employee.code,
      jobTitle: employee.jobTitle,
      hireDate: formatDate(employee.hireDate),
      companyId: employee.companyId,
      companyName: employee.company.name,
      active: employee.active,
    },
  });
});

router.get("/:id", async (req, res) => {
  const employeeId = Number(req.params.id);
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      company: true,
      periods: {
        include: { blocks: true },
        orderBy: { periodNumber: "asc" },
      },
    },
  });

  if (!employee) {
    return res.status(404).json({ message: "Funcionario nao encontrado." });
  }

  await syncEmployeePeriods(prisma, employee);

  const refreshed = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      company: true,
      periods: {
        include: { blocks: true },
        orderBy: { periodNumber: "asc" },
      },
    },
  });

  return res.json({
    employee: {
      id: refreshed.id,
      name: refreshed.name,
      code: refreshed.code,
      jobTitle: refreshed.jobTitle,
      active: refreshed.active,
      hireDate: formatDate(refreshed.hireDate),
      companyId: refreshed.companyId,
      companyName: refreshed.company.name,
      cycleStartDate: formatDate(refreshed.cycleStartDate),
      cycleStartPeriod: refreshed.cycleStartPeriod,
      periods: refreshed.periods.map((period) => serializeVacationPeriod(refreshed, period)),
    },
  });
});

router.patch("/:id", async (req, res) => {
  const parsed = employeeUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados para atualizacao invalidos." });
  }

  if (parsed.data.active === false && req.user.role !== "ADMIN") {
    return res.status(403).json({ message: "Somente o admin pode inativar funcionarios." });
  }

  const employeeId = Number(req.params.id);
  const existingEmployee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, code: true, active: true, companyId: true },
  });

  if (!existingEmployee) {
    return res.status(404).json({ message: "Funcionario nao encontrado." });
  }

  const data = {};
  const nextCode = parsed.data.code ? parsed.data.code.trim() : existingEmployee.code;
  const nextCompanyId = parsed.data.companyId || existingEmployee.companyId;
  const nextActive =
    typeof parsed.data.active === "boolean" ? parsed.data.active : existingEmployee.active;

  if (nextActive) {
    const conflict = await findActiveCodeConflict({
      employeeId,
      code: nextCode,
      companyId: nextCompanyId,
    });

    if (conflict) {
      return res.status(409).json({
        message: "Erro: Ja existe um funcionario com esse codigo nesta empresa.",
      });
    }
  }

  if (parsed.data.name) data.name = parsed.data.name.trim();
  if (parsed.data.code) data.code = nextCode;
  if (parsed.data.jobTitle) data.jobTitle = parsed.data.jobTitle.trim();
  if (parsed.data.companyId) data.companyId = parsed.data.companyId;
  if (parsed.data.hireDate) data.hireDate = parseDateInput(parsed.data.hireDate);
  if (typeof parsed.data.active === "boolean") data.active = parsed.data.active;

  const employee = await prisma.employee.update({
    where: { id: employeeId },
    data,
    include: { company: true },
  });

  await syncEmployeePeriods(prisma, employee);

  const employeeChangeParts = [];
  if (parsed.data.name) employeeChangeParts.push("nome");
  if (parsed.data.code) employeeChangeParts.push("codigo");
  if (parsed.data.jobTitle) employeeChangeParts.push("cargo");
  if (parsed.data.companyId) employeeChangeParts.push("empresa");
  if (parsed.data.hireDate) employeeChangeParts.push("admissao");
  if (typeof parsed.data.active === "boolean") {
    employeeChangeParts.push(employee.active ? "reativado" : "inativado");
  }

  await writeAuditLog(prisma, {
    user: req.user,
    action: "UPDATE_EMPLOYEE",
    entityType: "EMPLOYEE",
    entityId: employee.id,
    description: `Atualizou o funcionario ${employee.name} (${employee.code})${employeeChangeParts.length ? `: ${employeeChangeParts.join(", ")}` : ""}.`,
  });

  return res.json({
    employee: {
      id: employee.id,
      name: employee.name,
      code: employee.code,
      jobTitle: employee.jobTitle,
      active: employee.active,
      hireDate: formatDate(employee.hireDate),
      companyId: employee.companyId,
      companyName: employee.company.name,
      cycleStartDate: formatDate(employee.cycleStartDate),
      cycleStartPeriod: employee.cycleStartPeriod,
    },
  });
});

router.post("/:id/cycle", async (req, res) => {
  const parsed = cycleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados do ciclo aquisitivo invalidos." });
  }

  const employeeId = Number(req.params.id);
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      company: true,
      periods: {
        include: { blocks: true },
        orderBy: { periodNumber: "asc" },
      },
    },
  });

  if (!employee) {
    return res.status(404).json({ message: "Funcionario nao encontrado." });
  }

  const targetPeriod = employee.periods.find((period) => period.id === parsed.data.startPeriodId);
  if (!targetPeriod) {
    return res.status(404).json({ message: "Periodo inicial nao encontrado." });
  }

  const effectivePeriod = getEffectivePeriodDates(employee, targetPeriod);
  const cycleStartDate = dayjs
    .utc(effectivePeriod.acquisitionStart)
    .month(parsed.data.anchorMonth - 1)
    .date(parsed.data.anchorDay)
    .hour(12)
    .minute(0)
    .second(0)
    .millisecond(0);

  if (
    cycleStartDate.month() !== parsed.data.anchorMonth - 1 ||
    cycleStartDate.date() !== parsed.data.anchorDay
  ) {
    return res.status(400).json({ message: "Dia e mes informados nao formam uma data valida." });
  }

  await prisma.$transaction([
    prisma.employee.update({
      where: { id: employeeId },
      data: {
        cycleStartDate: cycleStartDate.toDate(),
        cycleStartPeriod: targetPeriod.periodNumber,
      },
    }),
    prisma.vacationPeriod.updateMany({
      where: {
        employeeId,
        periodNumber: { gte: targetPeriod.periodNumber },
      },
      data: {
        overrideAcquisitionStart: null,
        overrideAcquisitionEnd: null,
        overrideConcessionStart: null,
        overrideConcessionEnd: null,
        overrideDueDate: null,
      },
    }),
  ]);

  const refreshed = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      company: true,
      periods: {
        include: { blocks: true },
        orderBy: { periodNumber: "asc" },
      },
    },
  });

  await writeAuditLog(prisma, {
    user: req.user,
    action: "ADJUST_CYCLE",
    entityType: "EMPLOYEE",
    entityId: refreshed.id,
    description: `Ajustou o ciclo aquisitivo de ${refreshed.name} a partir do ${describePeriod(targetPeriod.periodNumber)} para ${String(parsed.data.anchorDay).padStart(2, "0")}/${String(parsed.data.anchorMonth).padStart(2, "0")}.`,
  });

  return res.json({
    employee: {
      id: refreshed.id,
      name: refreshed.name,
      code: refreshed.code,
      jobTitle: refreshed.jobTitle,
      active: refreshed.active,
      hireDate: formatDate(refreshed.hireDate),
      companyId: refreshed.companyId,
      companyName: refreshed.company.name,
      cycleStartDate: formatDate(refreshed.cycleStartDate),
      cycleStartPeriod: refreshed.cycleStartPeriod,
      periods: refreshed.periods.map((period) => serializeVacationPeriod(refreshed, period)),
    },
  });
});

router.patch("/:id/periods/:periodId", async (req, res) => {
  const parsed = periodSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados do periodo invalidos." });
  }

  const employeeId = Number(req.params.id);
  const periodId = Number(req.params.periodId);
  const period = await prisma.vacationPeriod.findFirst({
    where: { id: periodId, employeeId },
    include: { employee: true },
  });

  if (!period) {
    return res.status(404).json({ message: "Periodo nao encontrado." });
  }

  if (period.isAway && !isAwayUnlockOnly(parsed.data)) {
    return res.status(400).json({
      message: "Periodo afastado so pode ser alterado apos desmarcar a opcao de afastado.",
    });
  }

  const updated = await prisma.vacationPeriod.update({
    where: { id: periodId },
    data: {
      ...(parsed.data.totalDays ? { totalDays: parsed.data.totalDays } : {}),
      ...(parsed.data.importedUsedDays !== undefined
        ? { importedUsedDays: parsed.data.importedUsedDays }
        : {}),
      ...(typeof parsed.data.manuallyGranted === "boolean"
        ? { manuallyGranted: parsed.data.manuallyGranted }
        : {}),
      ...(typeof parsed.data.isAway === "boolean" ? { isAway: parsed.data.isAway } : {}),
      ...(typeof parsed.data.notes === "string" ? { notes: parsed.data.notes.trim() } : {}),
      ...(parsed.data.acquisitionStart !== undefined
        ? { overrideAcquisitionStart: parseOptionalDate(parsed.data.acquisitionStart) }
        : {}),
      ...(parsed.data.acquisitionEnd !== undefined
        ? { overrideAcquisitionEnd: parseOptionalDate(parsed.data.acquisitionEnd) }
        : {}),
      ...(parsed.data.concessionStart !== undefined
        ? { overrideConcessionStart: parseOptionalDate(parsed.data.concessionStart) }
        : {}),
      ...(parsed.data.concessionEnd !== undefined
        ? { overrideConcessionEnd: parseOptionalDate(parsed.data.concessionEnd) }
        : {}),
      ...(parsed.data.dueDate !== undefined
        ? { overrideDueDate: parseOptionalDate(parsed.data.dueDate) }
        : {}),
    },
    include: {
      employee: { include: { company: true } },
      blocks: true,
    },
  });

  const periodChanges = [];
  if (parsed.data.totalDays !== undefined) periodChanges.push("total de dias");
  if (parsed.data.importedUsedDays !== undefined) periodChanges.push("dias utilizados");
  if (parsed.data.manuallyGranted !== undefined) {
    periodChanges.push(parsed.data.manuallyGranted ? "marcado como ferias concedidas" : "reaberto");
  }
  if (parsed.data.isAway !== undefined) {
    periodChanges.push(parsed.data.isAway ? "marcado como afastado" : "afastamento removido");
  }
  if (parsed.data.notes !== undefined) periodChanges.push("observacao");
  if (parsed.data.acquisitionStart !== undefined || parsed.data.acquisitionEnd !== undefined) {
    periodChanges.push("datas aquisitivas");
  }
  if (parsed.data.concessionStart !== undefined || parsed.data.concessionEnd !== undefined) {
    periodChanges.push("datas concessivas");
  }
  if (parsed.data.dueDate !== undefined) periodChanges.push("vencimento");

  await writeAuditLog(prisma, {
    user: req.user,
    action: "UPDATE_PERIOD",
    entityType: "VACATION_PERIOD",
    entityId: updated.id,
    description: `Atualizou o ${describePeriod(updated.periodNumber)} de ${updated.employee.name}${periodChanges.length ? `: ${periodChanges.join(", ")}` : ""}.`,
  });

  return res.json({
    period: serializeVacationPeriod(updated.employee, updated),
  });
});

router.post("/:id/periods/:periodId/blocks", async (req, res) => {
  const parsed = blockSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados do bloco de ferias invalidos." });
  }

  const employeeId = Number(req.params.id);
  const periodId = Number(req.params.periodId);
  const period = await prisma.vacationPeriod.findFirst({
    where: { id: periodId, employeeId },
    include: { employee: true },
  });

  if (!period) {
    return res.status(404).json({ message: "Periodo nao encontrado." });
  }

  if (period.isAway) {
    return res.status(400).json({
      message: "Periodo afastado so pode ser alterado apos desmarcar a opcao de afastado.",
    });
  }

  const startDate = parseOptionalDate(parsed.data.startDate);
  const endDate = parseOptionalDate(parsed.data.endDate);
  const days = calculateBlockDays(startDate, endDate);

  const block = await prisma.vacationBlock.create({
    data: {
      vacationPeriodId: periodId,
      startDate,
      endDate,
      days,
      notes: parsed.data.notes?.trim() || null,
    },
  });

  await writeAuditLog(prisma, {
    user: req.user,
    action: "CREATE_BLOCK",
    entityType: "VACATION_BLOCK",
    entityId: block.id,
    description: `Adicionou bloco de ferias em ${period.employee.name} no ${describePeriod(period.periodNumber)} (${formatDate(block.startDate)} a ${formatDate(block.endDate)}).`,
  });

  return res.status(201).json({
    block: {
      id: block.id,
      startDate: formatDate(block.startDate),
      endDate: formatDate(block.endDate),
      days: block.days,
      notes: block.notes || "",
    },
  });
});

router.patch("/:id/periods/:periodId/blocks/:blockId", async (req, res) => {
  const parsed = blockSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados do bloco de ferias invalidos." });
  }

  const blockId = Number(req.params.blockId);
  const periodId = Number(req.params.periodId);
  const block = await prisma.vacationBlock.findFirst({
    where: {
      id: blockId,
      vacationPeriodId: periodId,
    },
    include: {
      vacationPeriod: {
        include: { employee: true },
      },
    },
  });

  if (!block) {
    return res.status(404).json({ message: "Bloco nao encontrado." });
  }

  if (block.vacationPeriod.isAway) {
    return res.status(400).json({
      message: "Periodo afastado so pode ser alterado apos desmarcar a opcao de afastado.",
    });
  }

  const startDate = parseOptionalDate(parsed.data.startDate);
  const endDate = parseOptionalDate(parsed.data.endDate);
  const days = calculateBlockDays(startDate, endDate);

  const updated = await prisma.vacationBlock.update({
    where: { id: blockId },
    data: {
      startDate,
      endDate,
      days,
      notes: parsed.data.notes?.trim() || null,
    },
  });

  await writeAuditLog(prisma, {
    user: req.user,
    action: "UPDATE_BLOCK",
    entityType: "VACATION_BLOCK",
    entityId: updated.id,
    description: `Atualizou bloco de ferias de ${block.vacationPeriod.employee.name} no ${describePeriod(block.vacationPeriod.periodNumber)} (${formatDate(updated.startDate)} a ${formatDate(updated.endDate)}).`,
  });

  return res.json({
    block: {
      id: updated.id,
      startDate: formatDate(updated.startDate),
      endDate: formatDate(updated.endDate),
      days: updated.days,
      notes: updated.notes || "",
    },
  });
});

router.delete("/:id/periods/:periodId/blocks/:blockId", async (req, res) => {
  const blockId = Number(req.params.blockId);
  const block = await prisma.vacationBlock.findUnique({
    where: { id: blockId },
    include: {
      vacationPeriod: {
        include: { employee: true },
      },
    },
  });

  if (!block) {
    return res.status(404).json({ message: "Bloco nao encontrado." });
  }

  if (block.vacationPeriod.isAway) {
    return res.status(400).json({
      message: "Periodo afastado so pode ser alterado apos desmarcar a opcao de afastado.",
    });
  }

  await prisma.vacationBlock.delete({
    where: { id: blockId },
  });

  await writeAuditLog(prisma, {
    user: req.user,
    action: "DELETE_BLOCK",
    entityType: "VACATION_BLOCK",
    entityId: blockId,
    description: `Excluiu bloco de ferias de ${block.vacationPeriod.employee.name} no ${describePeriod(block.vacationPeriod.periodNumber)} (${formatDate(block.startDate)} a ${formatDate(block.endDate)}).`,
  });

  return res.status(204).send();
});

module.exports = router;
