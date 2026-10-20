// The username becomes the tenant "slug" in every AWS resource name, so it must match
// the provisioner's rule exactly: 4-12 characters of a-z and 0-9.
export const USERNAME_RE = /^[a-z0-9]{4,12}$/;
export const RESERVED = new Set(["admin", "root", "support", "grainstack", "system", "billing", "aws"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function checkSignup(input: { username: string; email: string; password: string }): string | undefined {
  if (!USERNAME_RE.test(input.username)) return "Username must be 4 to 12 lowercase letters or numbers.";
  if (RESERVED.has(input.username)) return "That username is reserved. Choose another.";
  if (input.email.length > 254 || !EMAIL_RE.test(input.email)) return "Enter a valid email address.";
  if (input.password.length < 10) return "Password must be at least 10 characters.";
  if (input.password.length > 128) return "Password must be 128 characters or fewer.";
}
