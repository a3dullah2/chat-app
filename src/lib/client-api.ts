// Typed fetch wrapper for the REST API.

export class ApiClientError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (res.status === 204) {
    return undefined as T;
  }

  let data: unknown = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; code?: string };
    throw new ApiClientError(err.error ?? "Request failed", err.code ?? "UNKNOWN", res.status);
  }
  return data as T;
}

export function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

/** Uploads a file with an XMLHttpRequest so we get progress events. */
export function uploadFile(
  file: File,
  opts: { kind?: "avatar" } = {},
  onProgress?: (percent: number) => void,
): Promise<{ id: string; url: string; mimeType: string; size: number; fileName: string; thumbnailUrl?: string | null }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    if (opts.kind) form.append("kind", opts.kind);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    xhr.addEventListener("load", () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data.attachment);
        } else {
          reject(new ApiClientError(data.error ?? "Upload failed", data.code ?? "UPLOAD", xhr.status));
        }
      } catch {
        reject(new ApiClientError("Upload failed", "UPLOAD", xhr.status));
      }
    });
    xhr.addEventListener("error", () => reject(new ApiClientError("Upload failed", "NETWORK", 0)));
    xhr.send(form);
  });
}
