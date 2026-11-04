export const LOCAL_DEV_ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173"];

export function allowedOrigins(appOrigin?: string | null): string[] {
  return [...new Set([appOrigin, ...LOCAL_DEV_ORIGINS].filter((value): value is string => typeof value === "string" && value.length > 0))];
}

export function corsHeadersFor(origin: string, allowed: string[], methods = "POST, OPTIONS"): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : (allowed[0] ?? LOCAL_DEV_ORIGINS[0]),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
    "Access-Control-Allow-Methods": methods,
    "Vary": "Origin",
  };
}

export function corsHeadersForRequest(req: Request, appOrigin?: string | null, methods = "POST, OPTIONS"): Record<string, string> {
  return corsHeadersFor(req.headers.get("Origin") ?? "", allowedOrigins(appOrigin), methods);
}
