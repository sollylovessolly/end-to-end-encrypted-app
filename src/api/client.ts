const API_BASE_URL = "https://whisperbox.koyeb.app";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  token?: string | null;
  body?: unknown;
};

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = data?.detail ?? data?.message ?? data?.error;
    const message = Array.isArray(detail)
      ? detail
          .map((item) => {
            const location = Array.isArray(item.loc) ? item.loc.join(".") : "";
            return `${location ? `${location}: ` : ""}${item.msg}`;
          })
          .join("; ")
      : typeof detail === "string"
        ? detail
        : JSON.stringify(data);

    throw new Error(message || `API request failed with status ${response.status}`);
  }

  return data as T;
}
