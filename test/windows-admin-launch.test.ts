import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnSync = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawnSync }));
const { ELEVATED_PARENT_PREFIX, elevatedParentPid, powershellLiteral,
  waitForUnelevatedParent, isWindowsElevated, requestWindowsAdminLaunch } =
  await import('../src/main/windows-admin-launch.js');

beforeEach(() => {
  spawnSync.mockReset();
  spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });
});

function decodedScript() {
  const [exe, args, options] = spawnSync.mock.lastCall!;
  expect(exe).toBe('powershell.exe');
  expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand']);
  expect(options.windowsHide).toBe(true);
  return Buffer.from(args[3], 'base64').toString('utf16le');
}

describe('opt-in whole-app Windows UAC elevation', () => {
  it('rejects malformed, duplicated and self-referential parent hints', () => {
    expect(elevatedParentPid([])).toBeNull();
    expect(elevatedParentPid([ELEVATED_PARENT_PREFIX + '12;evil'])).toBeNull();
    expect(elevatedParentPid([ELEVATED_PARENT_PREFIX + '0'])).toBeNull();
    expect(elevatedParentPid([ELEVATED_PARENT_PREFIX + '2147483648'])).toBeNull();
    expect(elevatedParentPid([ELEVATED_PARENT_PREFIX + '123', ELEVATED_PARENT_PREFIX + '456'])).toBeNull();
    expect(elevatedParentPid([ELEVATED_PARENT_PREFIX + '123'])).toBe(123);
    waitForUnelevatedParent([ELEVATED_PARENT_PREFIX + process.pid], 'win32');
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('does nothing on non-Windows hosts and invalid executable inputs', () => {
    expect(requestWindowsAdminLaunch('app.exe', 123, 'linux')).toBe(false);
    expect(requestWindowsAdminLaunch('app.exe\0evil', 123, 'win32')).toBe(false);
    expect(requestWindowsAdminLaunch('app.exe', -1, 'win32')).toBe(false);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('asks Windows UAC with safely quoted executable path and a numeric parent', () => {
    expect(requestWindowsAdminLaunch("C:\\Program Files\\John's CoS\\CoS.exe", 321, 'win32')).toBe(true);
    const script = decodedScript();
    expect(script).toContain("Start-Process -FilePath 'C:\\Program Files\\John''s CoS\\CoS.exe'");
    expect(script).toContain("-ArgumentList '--cos-elevated-parent=321' -Verb RunAs");
    expect(script).not.toContain('-ExecutionPolicy Bypass');
  });

  it('keeps unelevated instance when UAC is denied', () => {
    spawnSync.mockReturnValue({ status: 1, stderr: 'The operation was canceled by the user' });
    expect(requestWindowsAdminLaunch('C:\\CoS.exe', 123, 'win32')).toBe(false);
  });

  it('waits for the old lock before the elevated process starts', () => {
    waitForUnelevatedParent([ELEVATED_PARENT_PREFIX + '123'], 'win32');
    expect(decodedScript()).toContain('Wait-Process -Id 123 -Timeout 60');
  });

  it('checks administrator role instead of trusting an argument', () => {
    expect(isWindowsElevated('win32')).toBe(true);
    expect(decodedScript()).toContain('WindowsBuiltInRole');
    spawnSync.mockReturnValue({ status: 1 });
    expect(isWindowsElevated('win32')).toBe(false);
  });

  it('escapes PowerShell literals without changing the executable path', () => {
    expect(powershellLiteral("a'b")).toBe("'a''b'");
  });
});
