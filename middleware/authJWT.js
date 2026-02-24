const jwt = require("jsonwebtoken");
const jwksRsa = require("jwks-rsa");
require("dotenv").config();

const jwksClient = jwksRsa({
  jwksUri: "https://fmupugulwdbiljgofibo.supabase.co/auth/v1/.well-known/jwks.json",
  cache: true,
  cacheMaxAge: 600000, // 10 minutes
});

function getSigningKey(header) {
  return new Promise((resolve, reject) => {
    jwksClient.getSigningKey(header.kid, (err, key) => {
      if (err) return reject(err);
      resolve(key.getPublicKey());
    });
  });
}

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Missing or invalid authorization header format",
      });
    }

    const token = authHeader.substring(7);

    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    // Decode header to get kid for JWKS lookup
    const decodedHeader = jwt.decode(token, { complete: true });
    if (!decodedHeader) {
      return res.status(403).json({ error: "Malformed token" });
    }

    const publicKey = await getSigningKey(decodedHeader.header);

    const decoded = jwt.verify(token, publicKey, {
      algorithms: ["ES256"],
      audience: "authenticated",
      issuer: "https://fmupugulwdbiljgofibo.supabase.co/auth/v1",
    });

    if (!decoded.sub || !decoded.role) {
      return res.status(403).json({ error: "Invalid token claims" });
    }

    req.userId = decoded.sub;
    req.userRole = decoded.role;
    req.userEmail = decoded.email;
    req.tokenPayload = decoded;

    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token has expired" });
    }
    if (error.name === "JsonWebTokenError") {
      return res.status(403).json({ error: "Invalid token" });
    }
    console.error("Token verification error:", error.message);
    return res.status(500).json({ error: "Token verification failed" });
  }
};

module.exports = { authenticateToken };
