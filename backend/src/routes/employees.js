const express = require("express");
const { z } = require("zod");

const prisma = require("../db");
const { authRequired } = require("../middleware");
const { parseDateInput, formatDate } = require("../utils/date");
const {
  calculateBlockDays,
  parseOptionalDate,
  serializeVacationPeriod,
  syncEmployeePeriods,
} = require("../utils/vacation");

const router = express.Router();

const employeeSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(1),
  companyId: z.coerce.number().int().positive(),
  hireDate: z.string().min(10),
});

const employeeUpdateSchema = employeeSchema.partial().extend({
  active: z.boolean().optional(),
});

const periodSchema = z.object({
  totalDays: z.coerce.number().int().min(1).max(120).optional(),
  manuallyGranted: z.boolean().optional(),
  notes: z.string().max(500).optional(),
  acquisitionStart: z.string().optional().nullable(),
  acquisitionEnd: z.string().optional().nullable(),
  concessionStart: z.string().optional().nullable(),
  concessionEnd: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
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

async function findActiveCodeConflict({ employeeId, code }) {
  if (!code) return null;

  return prisma.employee.findFirst({
    where: {
      code,
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
  const conflict = await findActiveCodeConflict({ code: normalizedCode });
  if (conflict) {
    return res.status(409).json({ message: "Erro: Já existe um funcionario com esse código." });
  }

  const employee = await prisma.employee.create({
    data: {
      name: parsed.data.name.trim(),
      code: normalizedCode,
      companyId: parsed.data.companyId,
      hireDate: parseDateInput(parsed.data.hireDate),
    },
    include: { company: true },
  });

  await syncEmployeePeriods(prisma, employee);

  return res.status(201).json({
    employee: {
      id: employee.id,
      name: employee.name,
      code: employee.code,
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
      active: refreshed.active,
      hireDate: formatDate(refreshed.hireDate),
      companyId: refreshed.companyId,
      companyName: refreshed.company.name,
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
    select: { id: true, code: true, active: true },
  });

  if (!existingEmployee) {
    return res.status(404).json({ message: "Funcionario nao encontrado." });
  }

  const data = {};
  const nextCode = parsed.data.code ? parsed.data.code.trim() : existingEmployee.code;
  const nextActive =
    typeof parsed.data.active === "boolean" ? parsed.data.active : existingEmployee.active;

  if (nextActive) {
    const conflict = await findActiveCodeConflict({
      employeeId,
      code: nextCode,
    });

    if (conflict) {
      return res.status(409).json({
        message: "Erro: Já existe um funcionario com esse código.",
      });
    }
  }

  if (parsed.data.name) data.name = parsed.data.name.trim();
  if (parsed.data.code) data.code = nextCode;
  if (parsed.data.companyId) data.companyId = parsed.data.companyId;
  if (parsed.data.hireDate) data.hireDate = parseDateInput(parsed.data.hireDate);
  if (typeof parsed.data.active === "boolean") data.active = parsed.data.active;

  const employee = await prisma.employee.update({
    where: { id: employeeId },
    data,
    include: { company: true },
  });

  await syncEmployeePeriods(prisma, employee);

  return res.json({
    employee: {
      id: employee.id,
      name: employee.name,
      code: employee.code,
      active: employee.active,
      hireDate: formatDate(employee.hireDate),
      companyId: employee.companyId,
      companyName: employee.company.name,
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
  });

  if (!period) {
    return res.status(404).json({ message: "Periodo nao encontrado." });
  }

  const updated = await prisma.vacationPeriod.update({
    where: { id: periodId },
    data: {
      ...(parsed.data.totalDays ? { totalDays: parsed.data.totalDays } : {}),
      ...(typeof parsed.data.manuallyGranted === "boolean"
        ? { manuallyGranted: parsed.data.manuallyGranted }
        : {}),
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
  });

  if (!period) {
    return res.status(404).json({ message: "Periodo nao encontrado." });
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
  });

  if (!block) {
    return res.status(404).json({ message: "Bloco nao encontrado." });
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
  await prisma.vacationBlock.delete({
    where: { id: blockId },
  });

  return res.status(204).send();
});

module.exports = router;
