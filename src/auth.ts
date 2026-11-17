import { createRemoteJWKSet, jwtVerify } from "jose";
import { ApiError, type Identity, email } from "./domain.js";
export type Auth = (token: string) => Promise<Identity>;
export function demoAuth(): Auth {
  return async (token) => {
    const identities: Record<string, Identity> = {
      "demo-lender": { id: "demo-alex", email: "alex@example.com" },
      "demo-borrower": { id: "demo-john", email: "john@example.com" },
      "demo-other": { id: "demo-sam", email: "sam@example.com" },
    };
    const user = identities[token];
    if (!user) throw new ApiError(401, "UNAUTHORIZED", "Invalid demo token.");
    return user;
  };
}
export function supabaseAuth(url: string, key: string): Auth {
  const base = url.replace(/\/$/, "");
  const issuer = `${base}/auth/v1`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: "authenticated",
        algorithms: ["ES256", "RS256"],
      });
      const response = await fetch(`${issuer}/user`, {
        headers: { Authorization: `Bearer ${token}`, apikey: key },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("User verification failed");
      const user = (await response.json()) as {
        id?: string;
        email?: string;
        email_confirmed_at?: string;
      };
      if (!payload.sub || user.id !== payload.sub || !user.email_confirmed_at)
        throw new Error("Email unverified");
      return { id: payload.sub, email: email.parse(user.email) };
    } catch {
      throw new ApiError(
        401,
        "UNAUTHORIZED",
        "A valid session with a verified email is required.",
      );
    }
  };
}
