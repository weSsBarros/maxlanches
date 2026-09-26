import crypto from 'node:crypto';
import { HttpError } from './http.js';

const SESSION_COOKIE = 'ml_session';
const SESSION_DAYS = 14;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Garante que exista ao menos um usuário administrador. Retorna a senha gerada, se houver. */
export function ensureAdminUser(db, { username, password }) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return null;
  const finalPassword = password || crypto.randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hashPassword(finalPassword));
  return password ? null : finalPassword;
}

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expires);
  return { token, maxAge: SESSION_DAYS * 86400_000 };
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function readSessionToken(req) {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function setSessionCookie(res, token, maxAge, secure) {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, maxAge, path: '/' });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Middleware: exige sessão válida e anexa req.user. */
export function requireAuth(db) {
  const findSession = db.prepare(`
    SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`);
  return (req, _res, next) => {
    const token = readSessionToken(req);
    const user = token && findSession.get(sha256(token), new Date().toISOString());
    if (!user) return next(new HttpError(401, 'Faça login para continuar.'));
    req.user = user;
    req.sessionToken = token;
    next();
  };
}
