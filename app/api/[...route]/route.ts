import type { NextRequest } from "next/server";
import { dispatch } from "@/lib/api/dispatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Context = { params: Promise<{ route: string[] }> };

async function run(method: string, request: NextRequest, context: Context) {
  const { route } = await context.params;
  return dispatch(method, request, route);
}

export function GET(request: NextRequest, context: Context) {
  return run("GET", request, context);
}

export function POST(request: NextRequest, context: Context) {
  return run("POST", request, context);
}

export function PUT(request: NextRequest, context: Context) {
  return run("PUT", request, context);
}

export function PATCH(request: NextRequest, context: Context) {
  return run("PATCH", request, context);
}

export function DELETE(request: NextRequest, context: Context) {
  return run("DELETE", request, context);
}

export function OPTIONS(request: NextRequest, context: Context) {
  return run("OPTIONS", request, context);
}
