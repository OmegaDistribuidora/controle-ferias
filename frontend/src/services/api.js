const API_BASE = "/api";
let unauthorizedHandler = null;

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(path, { token, headers = {}, body, method = "GET" } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body,
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    if (response.status === 401 && unauthorizedHandler) {
      unauthorizedHandler();
    }

    throw new ApiError(payload?.message || "Erro inesperado.", response.status);
  }

  return payload;
}

export function apiJson(path, { token, method = "GET", data } = {}) {
  return request(path, {
    token,
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: data ? JSON.stringify(data) : undefined,
  });
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}
