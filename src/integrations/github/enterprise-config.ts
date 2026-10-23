/**
 * GitHub Enterprise Server Configuration
 *
 * Resolves the REST API base URL for github.com or a GitHub Enterprise
 * Server (GHES) instance.
 */

export const GITHUB_COM_API_URL = 'https://api.github.com';
export const GHES_API_PATH = '/api/v3';

/**
 * Accepts a GHES host URL (`https://ghe.example.com`) or its API URL
 * (`https://ghe.example.com/api/v3`) and returns the normalized API URL.
 * Omitting the value keeps github.com. Only https is accepted.
 */
export function resolveGitHubApiBaseUrl(baseUrl?: string): string {
  if (baseUrl === undefined || baseUrl === '') {
    return GITHUB_COM_API_URL;
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('Invalid GitHub Enterprise Server URL');
  }

  if (url.protocol !== 'https:') {
    throw new Error('GitHub Enterprise Server URL must use https');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('GitHub Enterprise Server URL must not include credentials, query or fragment');
  }

  const path = url.pathname.replace(/\/+$/, '');
  if (path !== '' && path !== GHES_API_PATH) {
    throw new Error(`GitHub Enterprise Server URL path must be empty or ${GHES_API_PATH}`);
  }

  // api.github.com has no /api/v3 prefix.
  if (url.hostname === 'api.github.com' && path === '') {
    return GITHUB_COM_API_URL;
  }
  return `${url.origin}${GHES_API_PATH}`;
}
