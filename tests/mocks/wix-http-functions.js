// Plain objects so tests can assert on status and headers.
export const response = (options = {}) => ({ status: 200, ...options });
export const ok = (options = {}) => ({ ...options, status: 200 });
export const badRequest = (options = {}) => ({ ...options, status: 400 });
export const forbidden = (options = {}) => ({ ...options, status: 403 });
export const serverError = (options = {}) => ({ ...options, status: 500 });
