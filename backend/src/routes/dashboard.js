const express = require("express");

const prisma = require("../db");
const { authRequired } = require("../middleware");
const { serializeVacationPeriod, syncEmployeePeriods } = require("../utils/vacation");

const router = express.Router();

router.use(authRequired);

router.get("/", async (req, res) => {
  const employees = await prisma.employee.findMany({
    where: { active: true },
    include: {
      company: true,
    },
    orderBy: [{ company: { name: "asc" } }, { name: "asc" }],
  });

  for (const employee of employees) {
    await syncEmployeePeriods(prisma, employee);
  }

  const employeesWithPeriods = await prisma.employee.findMany({
    where: { active: true },
    include: {
      company: true,
      periods: {
        include: {
          blocks: true,
        },
        orderBy: { periodNumber: "asc" },
      },
    },
    orderBy: [{ company: { name: "asc" } }, { name: "asc" }],
  });

  const rows = employeesWithPeriods
    .flatMap((employee) =>
      employee.periods.map((period) => serializeVacationPeriod(employee, period))
    )
    .filter((period) => !period.granted)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  const summary = {
    employees: employeesWithPeriods.length,
    periodsOpen: rows.length,
    overdue: rows.filter((item) => item.urgency === "OVERDUE").length,
    dueSoon: rows.filter((item) => ["DUE_2", "DUE_3", "DUE_4", "DUE_5"].includes(item.urgency)).length,
  };

  return res.json({ rows, summary });
});

module.exports = router;

