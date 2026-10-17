// Everything was rewritten; the flagged code is gone.
import { execFile } from 'child_process';

export function lookup(name: string) {
  return execFile('nslookup', [name]);
}
