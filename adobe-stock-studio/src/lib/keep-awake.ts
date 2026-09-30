import { spawn, type ChildProcess } from 'node:child_process';
import { log } from './bus';

type Globals = typeof globalThis & { __stockStudioAwake?: ChildProcess | null };
const g = globalThis as Globals;

/**
 * Impede o computador de dormir enquanto a produção está ligada (o dia inteiro, se quiser).
 * Windows: SetThreadExecutionState via PowerShell · macOS: caffeinate · Linux: systemd-inhibit.
 * O processo auxiliar se encerra sozinho se o servidor fechar.
 */
export function keepAwake(on: boolean): void {
  if (!on) {
    g.__stockStudioAwake?.kill();
    g.__stockStudioAwake = null;
    return;
  }
  if (g.__stockStudioAwake) return;
  const pid = process.pid;
  let child: ChildProcess;
  if (process.platform === 'win32') {
    const script =
      `$s='[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);';` +
      `$t=Add-Type -MemberDefinition $s -Name P -Namespace W -PassThru;` +
      `while(Get-Process -Id ${pid} -ErrorAction SilentlyContinue){$t::SetThreadExecutionState(0x80000001)|Out-Null;Start-Sleep -Seconds 50}`;
    child = spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], { stdio: 'ignore', windowsHide: true });
  } else if (process.platform === 'darwin') {
    child = spawn('caffeinate', ['-i', '-w', String(pid)], { stdio: 'ignore' });
  } else {
    child = spawn(
      'systemd-inhibit',
      ['--what=idle:sleep', '--who=Stock Studio', '--why=Produção em andamento', 'sh', '-c', `while kill -0 ${pid} 2>/dev/null; do sleep 30; done`],
      { stdio: 'ignore' },
    );
  }
  child.on('error', (err) => {
    log.warn(`Não consegui impedir o computador de dormir (${err.message}). Ajuste a energia do sistema para não suspender.`);
    g.__stockStudioAwake = null;
  });
  child.on('exit', () => {
    if (g.__stockStudioAwake === child) g.__stockStudioAwake = null;
  });
  g.__stockStudioAwake = child;
}
