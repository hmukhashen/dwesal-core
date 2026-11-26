import { HTTPException } from "jsr:@hono/hono/http-exception";
import { ContentfulStatusCode } from "jsr:@hono/hono/utils/http-status";

const API_VERSION = "v24.0";
const FETCH_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * A sample of a media header for Meta's template review, given as a
 * short-lived https link (e.g. a signed storage URL) or inline base64.
 */
export type HeaderSample = {
  url?: string;
  base64?: string;
  mime_type: string;
  file_name?: string;
};

type MediaFormat = "IMAGE" | "VIDEO" | "DOCUMENT";

// Meta's limits for header samples.
const SAMPLE_TYPES: Record<string, { format: MediaFormat; maxBytes: number }> =
  {
    "image/jpeg": { format: "IMAGE", maxBytes: 5 * 1024 * 1024 },
    "image/png": { format: "IMAGE", maxBytes: 5 * 1024 * 1024 },
    "video/mp4": { format: "VIDEO", maxBytes: 16 * 1024 * 1024 },
    "application/pdf": { format: "DOCUMENT", maxBytes: 16 * 1024 * 1024 },
  };
const MAX_BASE64_BYTES = 5 * 1024 * 1024;

type Component = Record<string, unknown>;

/** Pure: the media format of the template's HEADER, or null. */
export function mediaHeaderFormat(components: unknown): MediaFormat | null {
  if (!Array.isArray(components)) return null;
  const header = components.find((c) =>
    String((c as Component)?.type ?? "").toUpperCase() === "HEADER"
  ) as Component | undefined;
  const format = String(header?.format ?? "").toUpperCase();
  return format === "IMAGE" || format === "VIDEO" || format === "DOCUMENT"
    ? format
    : null;
}

/** Pure: the components with the media HEADER's example set to the handle. */
export function withHeaderHandle(
  components: Component[],
  handle: string,
): Component[] {
  return components.map((c) =>
    String(c?.type ?? "").toUpperCase() === "HEADER"
      ? { ...c, example: { header_handle: [handle] } }
      : c
  );
}

// Literal private, loopback and link-local addresses and internal names.
// Hostnames that resolve to such addresses are not caught here; the caller
// already holds an admin key of the organization.
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") ||
    h.endsWith(".internal")
  ) return true;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127);
  }
  return h.includes(":") &&
    (h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") ||
      h.startsWith("fe80") || h.startsWith("::ffff:"));
}

/** Pure: why the sample cannot be used for a header of this format, or null. */
export function sampleError(
  sample: HeaderSample,
  format: MediaFormat,
): string | null {
  const type = SAMPLE_TYPES[sample?.mime_type ?? ""];
  if (!type) return "Unsupported header sample type";
  if (type.format !== format) {
    return `A ${sample.mime_type} sample does not fit a ${format} header`;
  }
  if (sample.base64) {
    return sample.base64.length > Math.ceil(MAX_BASE64_BYTES / 3) * 4 + 4
      ? "Inline header samples are limited to 5 MB; send a link"
      : null;
  }
  if (!sample.url) return "The header sample needs a url or base64";
  let url: URL;
  try {
    url = new URL(sample.url);
  } catch {
    return "The header sample url is not valid";
  }
  if (url.protocol !== "https:") return "The header sample url must be https";
  if (url.username || url.password || isPrivateHost(url.hostname)) {
    return "The header sample url is not allowed";
  }
  return null;
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const bin = atob(value.replace(/^data:[^,]*,/, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function loadSample(
  sample: HeaderSample,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (sample.base64) {
    const bytes = decodeBase64(sample.base64);
    if (bytes.length > Math.min(maxBytes, MAX_BASE64_BYTES)) {
      throw new HTTPException(413, { message: "The header sample is too big" });
    }
    return bytes;
  }

  let response: Response;
  try {
    // No redirects: a signed link answers directly, and a redirect could
    // point somewhere the checks above never saw.
    response = await fetch(sample.url!, {
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new HTTPException(422, {
      message: "Could not download the header sample",
    });
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new HTTPException(422, {
      message: "Could not download the header sample",
      cause: { status: response.status },
    });
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await response.body.cancel();
    throw new HTTPException(413, { message: "The header sample is too big" });
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new HTTPException(413, { message: "The header sample is too big" });
    }
    chunks.push(chunk);
  }
  if (size === 0) {
    throw new HTTPException(422, { message: "The header sample is empty" });
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return bytes;
}

function appId(): string {
  // With several apps configured, the first is the platform's own.
  const id = Deno.env.get("META_APP_ID")?.split("|")[0]?.trim();
  if (!id) {
    throw new HTTPException(500, {
      message: "META_APP_ID environment variable not set",
    });
  }
  return id;
}

async function metaError(response: Response, message: string) {
  const status = response.status >= 500 ? 502 : response.status;
  return new HTTPException(status as ContentfulStatusCode, {
    message,
    cause: await response.json().catch(() => ({})),
  });
}

/**
 * Meta's Resumable Upload API: opens an upload session on the app, sends the
 * bytes in one piece and returns the file handle ("4::…") that a template's
 * media header takes as `example.header_handle`.
 */
export async function uploadHeaderSample(
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
  fileName: string,
  accessToken: string,
): Promise<string> {
  const params = new URLSearchParams({
    file_name: fileName,
    file_length: String(bytes.length),
    file_type: mimeType,
  });
  const session = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${appId()}/uploads?${params}`,
    {
      method: "POST",
      headers: { Authorization: `OAuth ${accessToken}` },
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    },
  );
  if (!session.ok) {
    throw await metaError(session, "Could not start the header sample upload");
  }
  const { id } = await session.json() as { id?: string };
  if (!id?.startsWith("upload:")) {
    throw new HTTPException(502, {
      message: "Meta returned no upload session",
    });
  }

  const upload = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${id}`,
    {
      method: "POST",
      headers: {
        Authorization: `OAuth ${accessToken}`,
        file_offset: "0",
        "Content-Type": "application/octet-stream",
      },
      body: bytes,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    },
  );
  if (!upload.ok) {
    throw await metaError(upload, "Could not upload the header sample");
  }
  const { h } = await upload.json() as { h?: string };
  if (!h) {
    throw new HTTPException(502, { message: "Meta returned no file handle" });
  }
  return h;
}

/**
 * The template's components with the media header's sample uploaded to Meta
 * and its handle set. Without a sample, or without a media header, the
 * components are returned as they are.
 */
export async function applyHeaderSample<T>(
  components: T,
  sample: HeaderSample | undefined,
  accessToken: string,
): Promise<T> {
  const format = mediaHeaderFormat(components);
  if (!sample || !format) return components;
  const problem = sampleError(sample, format);
  if (problem) throw new HTTPException(400, { message: problem });
  const bytes = await loadSample(
    sample,
    SAMPLE_TYPES[sample.mime_type].maxBytes,
  );
  const fileName = (sample.file_name || "sample").replace(/[^\w.\-]+/g, "_")
    .slice(0, 100);
  const handle = await uploadHeaderSample(
    bytes,
    sample.mime_type,
    fileName,
    accessToken,
  );
  return withHeaderHandle(components as unknown as Component[], handle) as T;
}
