import axios from 'axios';
import { resolveGitHubApiBaseUrl, GITHUB_COM_API_URL } from '../enterprise-config';
import { GitHubClient } from '../github-client';

jest.mock('axios');
jest.mock('../../../security/dns', () => ({ createSafeAgent: jest.fn() }));

describe('resolveGitHubApiBaseUrl', () => {
  it('defaults to github.com', () => {
    expect(resolveGitHubApiBaseUrl()).toBe(GITHUB_COM_API_URL);
    expect(resolveGitHubApiBaseUrl('')).toBe(GITHUB_COM_API_URL);
    expect(resolveGitHubApiBaseUrl('https://api.github.com')).toBe(GITHUB_COM_API_URL);
  });

  it('appends /api/v3 to a GHES host URL', () => {
    expect(resolveGitHubApiBaseUrl('https://ghe.example.com')).toBe('https://ghe.example.com/api/v3');
    expect(resolveGitHubApiBaseUrl('https://ghe.example.com/')).toBe('https://ghe.example.com/api/v3');
    expect(resolveGitHubApiBaseUrl('https://ghe.example.com:8443')).toBe(
      'https://ghe.example.com:8443/api/v3',
    );
  });

  it('accepts an explicit API URL', () => {
    expect(resolveGitHubApiBaseUrl('https://ghe.example.com/api/v3')).toBe(
      'https://ghe.example.com/api/v3',
    );
    expect(resolveGitHubApiBaseUrl('https://ghe.example.com/api/v3/')).toBe(
      'https://ghe.example.com/api/v3',
    );
  });

  it('rejects unsupported input', () => {
    expect(() => resolveGitHubApiBaseUrl('not a url')).toThrow(/Invalid/);
    expect(() => resolveGitHubApiBaseUrl('http://ghe.example.com')).toThrow(/https/);
    expect(() => resolveGitHubApiBaseUrl('https://user:pw@ghe.example.com')).toThrow(/credentials/);
    expect(() => resolveGitHubApiBaseUrl('https://ghe.example.com?x=1')).toThrow(/query/);
    expect(() => resolveGitHubApiBaseUrl('https://ghe.example.com/api/v4')).toThrow(/path/);
  });
});

describe('GitHubClient base URL', () => {
  beforeEach(() => {
    (axios.create as jest.Mock).mockReturnValue({
      interceptors: { response: { use: jest.fn() } },
    });
  });

  it('keeps github.com when baseUrl is not set', () => {
    new GitHubClient({ token: 't' });
    expect((axios.create as jest.Mock).mock.calls.pop()[0].baseURL).toBe(GITHUB_COM_API_URL);
  });

  it('uses the configured GHES API URL', () => {
    new GitHubClient({ token: 't', baseUrl: 'https://ghe.example.com' });
    expect((axios.create as jest.Mock).mock.calls.pop()[0].baseURL).toBe(
      'https://ghe.example.com/api/v3',
    );
  });

  it('fails fast on an invalid baseUrl', () => {
    expect(() => new GitHubClient({ baseUrl: 'http://ghe.example.com' })).toThrow(/https/);
  });
});
