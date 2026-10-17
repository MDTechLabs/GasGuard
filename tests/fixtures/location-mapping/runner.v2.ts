import { exec, execFile } from 'child_process';
import { logger } from './logger';

/**
 * Diagnostics helpers.
 */

export function ping(host: string) {
  logger.info('ping', host);
  return execFile('ping', ['-c', '1', host]);
}

export function traceroute(host: string) {
  return execFile('traceroute', [host]);
}

export function lookup(name: string) {
  const cmd = `nslookup ${name}`;
  return exec(cmd);
}

export function logTail(path: string) {
  const cmd = `tail -n 20 ${path}`;
  return exec(cmd);
}
