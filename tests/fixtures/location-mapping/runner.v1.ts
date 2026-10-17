import { exec, execFile } from 'child_process';

export function ping(host: string) {
  return execFile('ping', ['-c', '1', host]);
}

export function lookup(name: string) {
  const cmd = `nslookup ${name}`;
  return exec(cmd);
}

export function logTail(path: string) {
  const cmd = `tail -n 20 ${path}`;
  return exec(cmd);
}
