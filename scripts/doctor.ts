import { execFileSync } from 'node:child_process';
import net from 'node:net';

interface CheckResult {
  ok: boolean;
  message: string;
}

function command(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function main(): Promise<void> {
  const results: CheckResult[] = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  results.push({
  ok: nodeMajor === 22 || nodeMajor === 24,
  message: `Node ${process.versions.node} (${nodeMajor === 22 || nodeMajor === 24 ? 'supported' : 'install Node 22 or 24'})`,
  });

  const dockerVersion = command('docker', ['--version']);
  results.push({ ok: dockerVersion !== null, message: dockerVersion ?? 'Docker not found; install Docker Desktop or Docker Engine' });

  const funcVersion = command('func', ['--version']);
  const funcMajor = Number(funcVersion?.split('.')[0]);
  results.push({
  ok: funcVersion !== null && funcMajor >= 4,
  message: funcVersion ? `Azure Functions Core Tools ${funcVersion}` : 'Azure Functions Core Tools v4 not found',
  });

  const dotnetVersion = command('dotnet', ['--version']);
  results.push({
  ok: true,
  message: dotnetVersion
    ? `.NET SDK ${dotnetVersion} (optional; extension bundle 4.38.1 includes the required Durable extension)`
    : '.NET SDK not found (optional)',
  });

  const containers = [
  ['ticketing-db', 5433],
    ['ticketing-payment-sim', 4100],
    ['ticketing-mailpit', 1025],
    ['ticketing-mailpit', 8025],
  ['ticketing-dts-emulator', 8080],
  ['ticketing-dts-emulator', 8082],
  ['ticketing-azurite', 10000],
  ] as const;
  const running = containers.filter(([name]) => command('docker', ['inspect', name]) !== null);
  if (running.length === 0) {
    results.push({ ok: true, message: 'Infrastructure is not running yet; start it with npm run infra:up, then rerun doctor' });
  } else {
    for (const [name, port] of containers) {
      const health = command('docker', ['inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', name]);
      const reachable = await portOpen(port);
      results.push({
        ok: health === 'healthy' && reachable,
        message: `${name} port ${port}: health=${health ?? 'missing'}, reachable=${reachable}`,
      });
    }
  }

  for (const result of results) process.stdout.write(`${result.ok ? 'PASS' : 'FAIL'} ${result.message}\n`);
  if (results.some((result) => !result.ok)) {
    process.stderr.write('Fix the failed checks above and run npm run doctor again.\n');
    process.exitCode = 1;
  }
}

void main();
