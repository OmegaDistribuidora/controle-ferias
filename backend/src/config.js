module.exports = {
  port: Number(process.env.PORT || 3000),
  jwtSecret: process.env.JWT_SECRET || "dev-secret",
  nodeEnv: process.env.NODE_ENV || "development",
};

