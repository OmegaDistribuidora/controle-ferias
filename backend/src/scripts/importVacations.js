const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const XLSX = require("xlsx");

const prisma = require("../db");
const { dayjs, parseDateInput } = require("../utils/date");
const { getEligiblePeriodCount, getPeriodNumberFromDate } = require("../utils/vacation");

const envPaths = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env"),
  path.resolve(__dirname, "..", "..", "..", ".env"),
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

function normalizeHeader(header) {
  return String(header || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function parseBrazilianDate(value) {
  if (!value) return null;
  if (typeof value === "number") {
    const parts = XLSX.SSF.parse_date_code(value);
    if (!parts) {
      throw new Error(`Data invalida encontrada: ${value}`);
    }
    const iso = `${String(parts.y).padStart(4, "0")}-${String(parts.m).padStart(2, "0")}-${String(parts.d).padStart(2, "0")}`;
    return parseDateInput(iso);
  }
  const raw = String(value).trim();
  const parsed = dayjs(raw, "DD/MM/YYYY", true);
  if (!parsed.isValid()) {
    throw new Error(`Data invalida encontrada: ${raw}`);
  }
  return parseDateInput(parsed.format("YYYY-MM-DD"));
}

function extractDateRanges(obs) {
  const matches = [];
  const text = String(obs || "");
  const regex = /(\d{2}\/\d{2}\/\d{4})\s*[aA]\s*(\d{2}\/\d{2}\/\d{4})/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const startDate = parseBrazilianDate(match[1]);
    const endDate = parseBrazilianDate(match[2]);
    const days = dayjs(endDate).diff(dayjs(startDate), "day") + 1;
    matches.push({ startDate, endDate, days, notes: text.trim() || null });
  }

  return matches;
}

function buildRow(rawRow) {
  const row = {};
  Object.entries(rawRow).forEach(([key, value]) => {
    row[normalizeHeader(key)] = value;
  });

  const companyName = String(row.empresa || "").trim();
  const code = String(row.cod || "").trim();
  const name = String(row.nome || "").trim();
  const jobTitle = String(row.cargo || "").trim();
  const hireDate = parseBrazilianDate(row.admissao);
  const acquisitionStart = parseBrazilianDate(row.inicio);
  const acquisitionEnd = parseBrazilianDate(row.final);
  const dueDate = parseBrazilianDate(row.vencimento);
  const remainingDays = Number(row.dias ?? row.ferias ?? 30);
  const notes = String(row.obs || "").trim();
  const isAway = notes.toLowerCase().includes("afastado");

  if (!companyName || !code || !name || !jobTitle || !hireDate || !acquisitionStart || !acquisitionEnd || !dueDate) {
    throw new Error(`Linha invalida para importacao: ${JSON.stringify(rawRow)}`);
  }

  return {
    companyName,
    code,
    name,
    jobTitle,
    hireDate,
    acquisitionStart,
    acquisitionEnd,
    dueDate,
    remainingDays,
    notes,
    isAway,
  };
}

async function findOrCreateCompany(companyName) {
  const existing = await prisma.company.findFirst({
    where: {
      name: companyName,
    },
  });

  if (existing) {
    if (!existing.active) {
      return prisma.company.update({
        where: { id: existing.id },
        data: { active: true },
      });
    }
    return existing;
  }

  return prisma.company.create({
    data: {
      name: companyName,
      active: true,
    },
  });
}

async function upsertEmployee(baseData) {
  const existing = await prisma.employee.findFirst({
    where: {
      code: baseData.code,
      companyId: baseData.companyId,
    },
  });

  if (existing) {
    return prisma.employee.update({
      where: { id: existing.id },
      data: {
        name: baseData.name,
        jobTitle: baseData.jobTitle,
        hireDate: baseData.hireDate,
        companyId: baseData.companyId,
        active: true,
      },
    });
  }

  return prisma.employee.create({
    data: {
      name: baseData.name,
      code: baseData.code,
      jobTitle: baseData.jobTitle,
      hireDate: baseData.hireDate,
      companyId: baseData.companyId,
      active: true,
    },
  });
}

async function importEmployeePeriods(employee, rows) {
  const sortedRows = rows
    .map((row) => ({
      ...row,
      periodNumber: getPeriodNumberFromDate(employee.hireDate, row.acquisitionStart),
    }))
    .sort((a, b) => a.periodNumber - b.periodNumber);

  const firstDifferentAnchor = sortedRows.find((row) => {
    const hire = dayjs(employee.hireDate);
    const start = dayjs(row.acquisitionStart);
    return hire.date() !== start.date() || hire.month() !== start.month();
  });

  const cycleData = firstDifferentAnchor
    ? {
        cycleStartDate: firstDifferentAnchor.acquisitionStart,
        cycleStartPeriod: firstDifferentAnchor.periodNumber,
      }
    : {
        cycleStartDate: null,
        cycleStartPeriod: null,
      };

  await prisma.employee.update({
    where: { id: employee.id },
    data: cycleData,
  });

  await prisma.vacationPeriod.deleteMany({
    where: { employeeId: employee.id },
  });

  const refreshedEmployee = {
    ...employee,
    ...cycleData,
  };

  const eligibleCount = getEligiblePeriodCount(refreshedEmployee.hireDate);
  const importedByPeriod = new Map(sortedRows.map((row) => [row.periodNumber, row]));

  for (let periodNumber = 0; periodNumber < eligibleCount; periodNumber += 1) {
    const imported = importedByPeriod.get(periodNumber);

    if (!imported) {
      await prisma.vacationPeriod.create({
        data: {
          employeeId: employee.id,
          periodNumber,
          manuallyGranted: true,
        },
      });
      continue;
    }

    const totalDays = 30;
    const expectedUsedDays = Math.max(totalDays - imported.remainingDays, 0);
    const blocks = extractDateRanges(imported.notes);
    const usedDaysByBlocks = blocks.reduce((sum, block) => sum + block.days, 0);
    const importedUsedDays = Math.max(expectedUsedDays - usedDaysByBlocks, 0);

    const period = await prisma.vacationPeriod.create({
      data: {
        employeeId: employee.id,
        periodNumber,
        overrideAcquisitionStart: imported.acquisitionStart,
        overrideAcquisitionEnd: imported.acquisitionEnd,
        overrideConcessionStart: dayjs(imported.acquisitionEnd).add(1, "day").toDate(),
        overrideConcessionEnd: imported.dueDate,
        overrideDueDate: imported.dueDate,
        totalDays,
        importedUsedDays,
        manuallyGranted: imported.remainingDays <= 0,
        isAway: imported.isAway,
        notes: imported.notes || null,
      },
    });

    if (blocks.length) {
      await prisma.vacationBlock.createMany({
        data: blocks.map((block) => ({
          vacationPeriodId: period.id,
          startDate: block.startDate,
          endDate: block.endDate,
          days: block.days,
          notes: block.notes,
        })),
      });
    }
  }
}

async function main() {
  const filepath = process.argv[2];
  const requestedSheetName = process.argv[3];
  if (!filepath) {
    throw new Error("Informe o caminho do arquivo. Ex.: npm run import:vacations -- C:\\dados\\ferias.xlsx Plan1");
  }

  const workbook = XLSX.readFile(filepath, { cellDates: false });
  const sheetName = requestedSheetName || workbook.SheetNames[0];
  if (!workbook.Sheets[sheetName]) {
    throw new Error(`A folha ${sheetName} nao foi encontrada no arquivo.`);
  }
  const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    defval: "",
  });

  const rows = rawRows.map(buildRow);
  const companyCodeNameMap = new Map();
  const grouped = new Map();

  for (const row of rows) {
    const companyCodeKey = `${row.companyName}::${row.code}`;
    if (!companyCodeNameMap.has(companyCodeKey)) {
      companyCodeNameMap.set(companyCodeKey, new Set());
    }
    companyCodeNameMap.get(companyCodeKey).add(row.name);

    const key = `${row.companyName}::${row.code}::${row.name}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(row);
  }

  const duplicates = [...companyCodeNameMap.entries()]
    .map(([key, names]) => {
      const [companyName, code] = key.split("::");
      return {
        companyName,
        code,
        names: [...names],
      };
    })
    .filter((item) => item.names.length > 1);

  if (duplicates.length) {
    throw new Error(
      `Existem codigos duplicados dentro da mesma empresa na planilha: ${JSON.stringify(duplicates)}`
    );
  }

  await prisma.$connect();

  for (const employeeRows of grouped.values()) {
    const firstRow = employeeRows[0];
    const company = await findOrCreateCompany(firstRow.companyName);
    const employee = await upsertEmployee({
      code: firstRow.code,
      name: firstRow.name,
      jobTitle: firstRow.jobTitle,
      hireDate: firstRow.hireDate,
      companyId: company.id,
    });

    await importEmployeePeriods(employee, employeeRows);
  }

  // eslint-disable-next-line no-console
  console.log(`Importacao concluida. Funcionarios processados: ${grouped.size}`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error("Falha na importacao:", error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

module.exports = {
  main,
};
