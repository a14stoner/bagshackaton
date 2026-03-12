const INTERNAL_NEXT_BASE_URL = process.env.NEXT_INTERNAL_BASE_URL ?? "http://localhost:3000";

function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const isServerRuntime = typeof process !== "undefined" && Boolean(process.versions?.node);
  if (isServerRuntime) {
    return `${INTERNAL_NEXT_BASE_URL}/api${normalizedPath}`;
  }
  return `/api${normalizedPath}`;
}

export async function apiFetch<T>(path: string): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    next: { revalidate: 15 }
  });

  if (!response.ok) {
    let detail = "";
    try {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const payload = (await response.json()) as Record<string, unknown>;
        detail = JSON.stringify(payload);
      } else {
        detail = await response.text();
      }
    } catch {
      detail = "";
    }
    throw new Error(`Request failed: ${response.status}${detail ? ` - ${detail}` : ""}`);
  }

  return response.json() as Promise<T>;
}
