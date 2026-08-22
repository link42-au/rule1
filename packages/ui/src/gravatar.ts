// ── Gravatar URL Helper ──────────────────────────────────
// Uses SHA-256 (supported by Gravatar since 2023) via SubtleCrypto,
// which is available in all modern browsers and Cloudflare Workers.

export async function gravatarUrl(email: string, size = 64): Promise<string> {
	const normalized = email.trim().toLowerCase();
	const encoder = new TextEncoder();
	const data = encoder.encode(normalized);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashHex = Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return `https://gravatar.com/avatar/${hashHex}?d=404&s=${size}`;
}
