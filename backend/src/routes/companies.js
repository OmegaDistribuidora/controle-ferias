const express = require("express");
const { z } = require("zod");

const prisma = require("../db");
const { authRequired, requireRole } = require("../middleware");
const { writeAuditLog } = require("../services/audit");

const router = express.Router();

const companySchema = z.object({
  name: z.string().min(2),
  active: z.boolean().optional(),
});

router.use(authRequired);

router.get("/", async (req, res) => {
  const companies = await prisma.company.findMany({
    orderBy: { name: "asc" },
  });

  return res.json({ companies });
});

router.post("/", requireRole("ADMIN"), async (req, res) => {
  const parsed = companySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Nome da empresa invalido." });
  }

  const company = await prisma.company.create({
    data: {
      name: parsed.data.name.trim(),
      active: parsed.data.active ?? true,
    },
  });

  await writeAuditLog(prisma, {
    user: req.user,
    action: "CREATE_COMPANY",
    entityType: "COMPANY",
    entityId: company.id,
    description: `Criou a empresa ${company.name}.`,
  });

  return res.status(201).json({ company });
});

router.patch("/:id", requireRole("ADMIN"), async (req, res) => {
  const parsed = companySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dados da empresa invalidos." });
  }

  const company = await prisma.company.update({
    where: { id: Number(req.params.id) },
    data: {
      name: parsed.data.name.trim(),
      ...(typeof parsed.data.active === "boolean" ? { active: parsed.data.active } : {}),
    },
  });

  await writeAuditLog(prisma, {
    user: req.user,
    action: "UPDATE_COMPANY",
    entityType: "COMPANY",
    entityId: company.id,
    description: `Atualizou a empresa ${company.name} para status ${company.active ? "ativa" : "inativa"}.`,
  });

  return res.json({ company });
});

module.exports = router;
