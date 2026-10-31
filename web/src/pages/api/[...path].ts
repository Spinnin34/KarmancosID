import type { APIRoute } from "astro";
import { handleIdentityRequest } from "../../server/identity/handler";

export const prerender = false;

export const GET: APIRoute = ({ request }) => handleIdentityRequest(request);
export const POST: APIRoute = ({ request }) => handleIdentityRequest(request);
export const PATCH: APIRoute = ({ request }) => handleIdentityRequest(request);
export const PUT: APIRoute = ({ request }) => handleIdentityRequest(request);
export const DELETE: APIRoute = ({ request }) => handleIdentityRequest(request);
export const OPTIONS: APIRoute = ({ request }) => handleIdentityRequest(request);
