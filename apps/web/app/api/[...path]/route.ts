import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveBackendApiUrl(): string | null {
  return process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? null;
}

function shouldUseInsecureTls(): boolean {
  const value = process.env.API_PROXY_INSECURE_TLS ?? "false";
  return value === "true" || value === "1";
}

if (shouldUseInsecureTls()) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

function buildTargetUrl(request: NextRequest, backendApiUrl: string, path: string[] | undefined): string {
  const requestUrl = new URL(request.url);
  const cleanedPath = (path ?? []).filter(Boolean).map((segment) => encodeURIComponent(segment)).join("/");
  const backendBase = backendApiUrl.endsWith("/") ? backendApiUrl.slice(0, -1) : backendApiUrl;
  const target = `${backendBase}/${cleanedPath}`;
  return `${target}${requestUrl.search}`;
}

async function proxyToBackend(request: NextRequest, path: string[] | undefined): Promise<Response> {
  const backendApiUrl = resolveBackendApiUrl();
  if (!backendApiUrl) {
    return new Response(
      JSON.stringify({
        error: "Missing backend API URL. Set API_URL (or NEXT_PUBLIC_API_URL) for apps/web runtime."
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" }
      }
    );
  }
  const targetUrl = buildTargetUrl(request, backendApiUrl, path);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");
  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
      cache: "no-store"
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  } catch (error) {
    const err = error as
      | (Error & {
          cause?: {
            code?: string;
            errno?: string | number;
            syscall?: string;
            address?: string;
            port?: number;
          };
        })
      | undefined;
    const message = err?.message ?? "Unknown proxy fetch error";
    return new Response(
      JSON.stringify({
        error: "Backend proxy request failed",
        targetUrl,
        message,
        cause: err?.cause
          ? {
              code: err.cause.code,
              errno: err.cause.errno,
              syscall: err.cause.syscall,
              address: err.cause.address,
              port: err.cause.port
            }
          : null
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" }
      }
    );
  }
}

type RouteContext = { params: Promise<{ path?: string[] }> };

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  return proxyToBackend(request, (await context.params).path);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  return proxyToBackend(request, (await context.params).path);
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<Response> {
  return proxyToBackend(request, (await context.params).path);
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<Response> {
  return proxyToBackend(request, (await context.params).path);
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<Response> {
  return proxyToBackend(request, (await context.params).path);
}
