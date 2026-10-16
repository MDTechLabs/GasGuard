import { validateUrlForSsrf } from "../../../../src/security/ssrf";

export async function safeFetch(req: any) {
  const target = req.query.url;
  await validateUrlForSsrf(target);
  return fetch(target);
}

export async function fetchStaticEndpoint() {
  return fetch("https://api.github.com/status");
}
