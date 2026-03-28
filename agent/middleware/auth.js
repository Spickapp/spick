// middleware/auth.js – Bearer-token authentication
const logger = require("../logger");

/**
 * Validates the Authorization header against API_SECRET.
 * Accepts:  Authorization: Bearer <token>
 *           ?token=<token>  (query param fallback for quick mobile testing)
 */
function authMiddleware(req, res, next) {
  const secret = process.env.API_SECRET;

  if (!secret || secret === "CHANGE_ME_TO_A_RANDOM_SECRET_KEY") {
    logger.error("API_SECRET is not configured – refusing all requests");
    return res.status(500).json({ error: "Server misconfigured: API_SECRET not set" });
  }

  // Extract token from header or query
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    logger.warn("Auth failed: no token provided", { ip: req.ip });
    return res.status(401).json({ error: "Missing authentication token" });
  }

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(token, secret)) {
    logger.warn("Auth failed: invalid token", { ip: req.ip });
    return res.status(403).json({ error: "Invalid authentication token" });
  }

  next();
}

function timingSafeEqual(a, b) {
  const crypto = require("crypto");
  if (a.length !== b.length) {
    // Still do a compare to keep constant time, then return false
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

module.exports = authMiddleware;
