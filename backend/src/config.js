module.exports = {
  port: Number(process.env.PORT || 3000),
  jwtSecret: process.env.JWT_SECRET || "dev-secret",
  nodeEnv: process.env.NODE_ENV || "development",
  ecosystemSso: {
    issuer: process.env.ECOSYSTEM_SSO_ISSUER || "ecosistema-omega",
    audience: process.env.ECOSYSTEM_SSO_AUDIENCE || "controle_ferias",
    sharedSecret: process.env.ECOSYSTEM_SSO_SHARED_SECRET || "",
  },
};
