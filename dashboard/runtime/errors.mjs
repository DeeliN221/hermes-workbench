export class RuntimeError extends Error {
  constructor(status, code, message = code) {
    super(message); this.status = status; this.code = code;
  }
}
export function publicError(error) {
  return {code: error instanceof RuntimeError ? error.code : 'runtime/unavailable',
    message: error instanceof RuntimeError ? error.message : 'DSH runtime unavailable',
    ...(error?.upstreamStatus ? {upstream_status: error.upstreamStatus} : {})};
}
export function httpFailure(status) {
  const e = new RuntimeError(502, 'dsh/http-error', `DSH HTTP ${status}`);
  e.upstreamStatus = status; return e;
}
export function nonempty(value, name, max = 4096) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value))
    throw new RuntimeError(400, 'runtime/invalid-input', `Invalid ${name}`);
  return value;
}
