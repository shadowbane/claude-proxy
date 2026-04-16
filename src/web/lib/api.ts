const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body.error?.message) message = body.error.message;
      else if (typeof body.error === 'string') message = body.error;
      else if (body.message) message = body.message;
    } catch {
      // not JSON
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function jsonInit(method: string, body?: unknown): RequestInit {
  if (body === undefined) {
    return { method };
  }
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, jsonInit('POST', body)),
  put: <T>(path: string, body?: unknown) => request<T>(path, jsonInit('PUT', body)),
  del: (path: string) => request<void>(path, { method: 'DELETE' }),
};
