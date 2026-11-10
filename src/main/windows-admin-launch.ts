/**
 * Optional whole-process elevation. Windows UAC is the authority, not a command-line
 * switch. Never elevate silently and never enable this from a damaged config.
 *
 * The elevated child waits for the unelevated parent to release Electron's
 * single-instance lock. The parent stays alive if UAC is cancelled or fails.
 */
import { spawnSync } from 'node:child_process';

export const ELEVATED_PARENT_PREFIX = '--cos-elevated-parent=';

export function elevatedParentPid(args: readonly string[]): number | null {
  const matches = args.filter(arg => arg.startsWith(ELEVATED_PARENT_PREFIX));
  if (matches.length !== 1) return null;
  const value = matches[0]!.slice(ELEVATED_PARENT_PREFIX.length);
  if (!/^[1-9][0-9]{0,9}$/.test(value)) return null;
  const pid = Number(value);
  return Number.isSafeInteger(pid) && pid <= 0x7fffffff ? pid : null;
}

export function powershellLiteral(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

function powershell(script: string, timeout: number) {
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], {
    windowsHide: true, timeout, encoding: 'utf8', maxBuffer: 4096
  });
}

export function waitForUnelevatedParent(args: readonly string[], platform = process.platform): void {
  if (platform !== 'win32') return;
  const pid = elevatedParentPid(args);
  if (pid === null || pid === process.pid) return;
  // A bounded wait before Electron acquires its single-instance lock.
  powershell(`Wait-Process -Id ${pid} -Timeout 60 -ErrorAction SilentlyContinue`, 65_000);
}

export function isWindowsElevated(platform = process.platform): boolean {
  if (platform !== 'win32') return false;
  const script = '$p=[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent(); ' +
    'if($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){exit 0}else{exit 1}';
  return powershell(script, 10_000).status === 0;
}

export function requestWindowsAdminLaunch(
  executable: string,
  parentPid: number,
  platform = process.platform
): boolean {
  if (platform !== 'win32' || !Number.isSafeInteger(parentPid) || parentPid <= 0 ||
      !executable || executable.includes('\0')) return false;
  // Start-Process -Verb RunAs invokes Windows UAC. A denied prompt throws and
  // returns nonzero, so the original unelevated app remains available.
  const script = `$ErrorActionPreference='Stop'; Start-Process -FilePath ${powershellLiteral(executable)} ` +
    `-ArgumentList ${powershellLiteral(ELEVATED_PARENT_PREFIX + parentPid)} -Verb RunAs -ErrorAction Stop | Out-Null`;
  return powershell(script, 120_000).status === 0;
}
