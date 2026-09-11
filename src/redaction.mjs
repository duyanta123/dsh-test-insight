const SECRET_KEY = /(authorization|api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd|private[_-]?key|secret|token)/i;
const AUTHORIZATION_VALUE = /((?:authorization|proxy-authorization)\s*[=:]\s*Bearer\s+)[^\s,;]+/gi;
const SECRET_ASSIGNMENT = /((?:authorization|api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd|private[_-]?key|secret|token)\s*[=:]\s*)(?!Bearer\b)([^\s,;]+)/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const BASIC_AUTH_URL = /(https?:\/\/)([^\s/@]+):([^\s/@]+)@/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

export const REDACTED = "[REDACTED]";

export function redactString(value) {
  if (typeof value !== "string") return value;
  return value
	.replace(BASIC_AUTH_URL, `$1${REDACTED}:${REDACTED}@`)
	.replace(AUTHORIZATION_VALUE, `$1${REDACTED}`)
	.replace(BEARER, `Bearer ${REDACTED}`)
	.replace(JWT, REDACTED)
	.replace(SECRET_ASSIGNMENT, `$1${REDACTED}`);
}

export function redactValue(value, key = "") {
  if (SECRET_KEY.test(key)) return REDACTED;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === "object") {
	return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactValue(childValue, childKey)]));
  }
  return value;
}
