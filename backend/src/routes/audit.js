const express = require("express");
const { Role } = require("@prisma/client");

const prisma = require("../db");
const { authRequired, requireRole } = require("../middleware");

const router = express.Router();

router.use(authRequired, requireRole(Role.ADMIN));

router.get("/", async (req, res) => {
  const requestedLimit = Number(req.query.limit || 200);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 1000) : 200;

  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      username: true,
      action: true,
      entityType: true,
      entityId: true,
      description: true,
      createdAt: true,
    },
  });

  return res.json({ logs });
});

module.exports = router;
