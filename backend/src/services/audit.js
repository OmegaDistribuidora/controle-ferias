async function writeAuditLog(prisma, { user, action, entityType, entityId, description }) {
  if (!user || !action || !entityType || !description) {
    return null;
  }

  return prisma.auditLog.create({
    data: {
      userId: user.userId ?? user.id ?? null,
      username: user.username,
      action,
      entityType,
      entityId: entityId ? String(entityId) : null,
      description,
    },
  });
}

module.exports = {
  writeAuditLog,
};
