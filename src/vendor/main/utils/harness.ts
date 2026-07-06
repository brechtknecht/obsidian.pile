import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';

export type HarnessType = 'claude' | 'codex';
export type ChatMessage = { role: string; content: string };

const GENERATION_TIMEOUT_MS = 180_000;

// Packaged Electron apps on macOS launch with a minimal PATH, so the
// usual CLI install locations have to be checked explicitly.
const EXTRA_PATHS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), '.bun', 'bin'),
  path.join(os.homedir(), '.npm-global', 'bin'),
  path.join(os.homedir(), 'bin'),
];

const binaryCache = new Map<HarnessType, string>();

// nvm initializes in .zshrc (interactive shells only), so npm-installed
// CLIs under nvm are invisible to login-shell lookups — scan directly.
function nvmBinDirs(): string[] {
  const versionsDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
  try {
    return fs
      .readdirSync(versionsDir)
      .sort()
      .reverse()
      .map((version) => path.join(versionsDir, version, 'bin'));
  } catch {
    return [];
  }
}

function harnessEnv() {
  const env = { ...process.env };
  env.PATH = [env.PATH, ...EXTRA_PATHS].filter(Boolean).join(path.delimiter);
  return env;
}

// The CLIs get an empty scratch directory as cwd so their file tools
// never see anything sensitive.
function scratchCwd() {
  const dir = path.join(os.tmpdir(), 'pile-harness');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loginShellLookup(binary: string): Promise<string | null> {
  if (process.platform === 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/bash';
    const child = spawn(shell, ['-lc', `command -v ${binary}`], {
      env: harnessEnv(),
      timeout: 10_000,
    });
    let out = '';
    child.stdout.on('data', (data) => {
      out += data.toString();
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      const lines = out.trim().split('\n').filter(Boolean);
      const last = lines[lines.length - 1];
      resolve(code === 0 && last ? last.trim() : null);
    });
  });
}

async function resolveBinary(harness: HarnessType): Promise<string | null> {
  const cached = binaryCache.get(harness);
  if (cached) return cached;

  const suffix = process.platform === 'win32' ? '.cmd' : '';
  const dirs = [...EXTRA_PATHS, ...nvmBinDirs()];
  for (const dir of dirs) {
    const candidate = path.join(dir, harness + suffix);
    if (fs.existsSync(candidate)) {
      binaryCache.set(harness, candidate);
      return candidate;
    }
  }

  const fromShell = await loginShellLookup(harness);
  if (fromShell) {
    binaryCache.set(harness, fromShell);
    return fromShell;
  }
  return null;
}

export async function getHarnessStatus() {
  const status: Record<
    string,
    {
      available: boolean;
      broken?: boolean;
      path?: string;
      version?: string | null;
    }
  > = {};

  for (const harness of ['claude', 'codex'] as HarnessType[]) {
    const bin = await resolveBinary(harness);
    if (!bin) {
      status[harness] = { available: false };
      continue;
    }
    const version = await new Promise<string | null>((resolve) => {
      const child = spawn(bin, ['--version'], {
        env: harnessEnv(),
        cwd: scratchCwd(),
        timeout: 15_000,
      });
      let out = '';
      child.stdout.on('data', (data) => {
        out += data.toString();
      });
      child.on('error', () => resolve(null));
      child.on('close', (code) => resolve(code === 0 ? out.trim() : null));
    });
    // A wrapper can exist while its real binary is broken or deleted
    // (e.g. quarantined by antivirus) — only a working --version counts.
    if (version === null) {
      status[harness] = { available: false, broken: true, path: bin };
    } else {
      status[harness] = { available: true, path: bin, version };
    }
  }

  return status;
}

function splitMessages(messages: ChatMessage[]) {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const conversation = messages
    .filter((m) => m.role !== 'system')
    .map((m) =>
      m.role === 'assistant' ? `Assistant: ${m.content}` : `User: ${m.content}`
    )
    .join('\n\n');
  return { system, conversation };
}

type StreamState = {
  text: string;
  streamed: boolean;
  error: string | null;
};

function runProcess(
  bin: string,
  args: string[],
  stdin: string,
  onLine: (line: string, state: StreamState) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: scratchCwd(), env: harnessEnv() });
    const state: StreamState = { text: '', streamed: false, error: null };
    const name = path.basename(bin);
    let stderr = '';
    let buffer = '';
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(state.text);
    };

    const timer = setTimeout(() => {
      fail(
        new Error(`${name} timed out after ${GENERATION_TIMEOUT_MS / 1000}s`)
      );
      child.kill('SIGKILL');
    }, GENERATION_TIMEOUT_MS);

    child.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) onLine(trimmed, state);
      }
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', (err) =>
      fail(new Error(`Failed to launch ${name}: ${err.message}`))
    );
    child.on('close', (code) => {
      if (state.error) return fail(new Error(state.error));
      if (code !== 0) {
        return fail(
          new Error(
            `${name} exited with code ${code}: ${stderr.slice(0, 500).trim()}`
          )
        );
      }
      if (!state.text) {
        return fail(
          new Error(
            `${name} returned no text. ${stderr.slice(0, 300).trim()}`.trim()
          )
        );
      }
      succeed();
    });

    try {
      child.stdin.write(stdin);
      child.stdin.end();
    } catch (err: any) {
      fail(new Error(`Failed to send prompt to ${name}: ${err.message}`));
    }
  });
}

function runClaude(
  bin: string,
  messages: ChatMessage[],
  model: string | undefined,
  onChunk: (chunk: string) => void
) {
  const { system, conversation } = splitMessages(messages);
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--max-turns',
    '1',
  ];
  if (system) args.push('--system-prompt', system);
  if (model) args.push('--model', model);

  return runProcess(bin, args, conversation, (line, state) => {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.type === 'stream_event') {
      const inner = event.event;
      if (
        inner?.type === 'content_block_delta' &&
        inner.delta?.type === 'text_delta' &&
        inner.delta.text
      ) {
        state.streamed = true;
        state.text += inner.delta.text;
        onChunk(inner.delta.text);
      }
    } else if (event.type === 'result') {
      if (event.is_error) {
        state.error =
          typeof event.result === 'string'
            ? event.result
            : 'Claude returned an error result';
      } else if (!state.streamed && typeof event.result === 'string') {
        // Older CLI versions without partial-message streaming still
        // deliver the full text in the final result event.
        state.text = event.result;
        onChunk(event.result);
      }
    }
  });
}

// Codex's JSONL event shape has changed across releases; accept the
// known variants of the final agent message.
function extractCodexMessage(event: any): string | null {
  if (event.type === 'item.completed') {
    const item = event.item;
    if (
      item &&
      (item.type === 'agent_message' || item.item_type === 'agent_message')
    ) {
      return item.text || null;
    }
  }
  if (event.msg && event.msg.type === 'agent_message') {
    return event.msg.message || null;
  }
  return null;
}

function runCodex(
  bin: string,
  messages: ChatMessage[],
  model: string | undefined,
  onChunk: (chunk: string) => void
) {
  const { system, conversation } = splitMessages(messages);
  const prompt = system
    ? `Instructions:\n${system}\n\n${conversation}`
    : conversation;
  const args = ['exec', '--json', '--skip-git-repo-check'];
  if (model) args.push('-m', model);
  args.push('-'); // read the prompt from stdin

  return runProcess(bin, args, prompt, (line, state) => {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    const text = extractCodexMessage(event);
    if (text) {
      state.text += text;
      onChunk(text);
    }
  });
}

export async function generateWithHarness(
  harness: HarnessType,
  messages: ChatMessage[],
  model: string | undefined,
  onChunk: (chunk: string) => void
): Promise<string> {
  if (harness !== 'claude' && harness !== 'codex') {
    throw new Error(`Unknown harness: ${harness}`);
  }
  const bin = await resolveBinary(harness);
  if (!bin) {
    throw new Error(
      `Could not find the ${harness} CLI. Install it and make sure it is on your PATH.`
    );
  }
  return harness === 'claude'
    ? runClaude(bin, messages, model, onChunk)
    : runCodex(bin, messages, model, onChunk);
}
