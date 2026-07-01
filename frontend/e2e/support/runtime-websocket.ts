import { type APIRequestContext, type APIResponse } from '@playwright/test';

const API_BASE_URL = process.env['E2E_API_BASE_URL'] ?? 'http://127.0.0.1:8000';
const RUNTIME_COMMAND_TIMEOUT_MS = 20_000;

type JsonObject = Record<string, unknown>;

interface RuntimeTicketPayload {
  websocketUrl?: string;
  route?: string;
}

interface RuntimeCommandOptions {
  gameId: string;
  token: string;
  baseVersion: number;
  type: string;
  payload: JsonObject;
  clientActionId?: string;
}

interface RuntimeMulliganKeepOptions {
  gameId: string;
  token: string;
  baseVersion?: number;
  bottomCardInstanceIds?: readonly string[];
  clientActionId?: string;
}

export interface RuntimeWebSocketCommandResult {
  clientActionId: string;
  version: number;
  patch: JsonObject;
  frames: JsonObject[];
}

export async function sendRuntimeCommand(
  request: APIRequestContext,
  options: RuntimeCommandOptions,
): Promise<RuntimeWebSocketCommandResult> {
  const clientActionId = options.clientActionId ?? runtimeActionId(options.type);
  return sendRuntimeWebSocketMessage(request, options.gameId, options.token, clientActionId, {
    kind: 'command.v2',
    gameId: options.gameId,
    messageId: clientActionId,
    baseVersion: options.baseVersion,
    clientActionId,
    type: options.type,
    payload: options.payload,
  });
}

export async function sendRuntimeMulliganKeep(
  request: APIRequestContext,
  options: RuntimeMulliganKeepOptions,
): Promise<RuntimeWebSocketCommandResult> {
  const clientActionId = options.clientActionId ?? runtimeActionId('mulligan.keep');
  return sendRuntimeWebSocketMessage(request, options.gameId, options.token, clientActionId, {
    kind: 'mulligan.keep',
    gameId: options.gameId,
    messageId: clientActionId,
    clientActionId,
    ...(typeof options.baseVersion === 'number' ? { baseVersion: options.baseVersion } : {}),
    ...(options.bottomCardInstanceIds && options.bottomCardInstanceIds.length > 0
      ? { bottomCardInstanceIds: [...options.bottomCardInstanceIds] }
      : {}),
  });
}

async function sendRuntimeWebSocketMessage(
  request: APIRequestContext,
  gameId: string,
  token: string,
  clientActionId: string,
  message: JsonObject,
): Promise<RuntimeWebSocketCommandResult> {
  const websocketUrl = await runtimeWebSocketUrl(request, gameId, token);
  const frames: JsonObject[] = [];

  return new Promise<RuntimeWebSocketCommandResult>((resolve, reject) => {
    const socket = new WebSocket(websocketUrl);
    let settled = false;
    const timeout = setTimeout(() => {
      fail(
        new Error(
          `Timed out waiting for runtime patch for ${String(message['kind'])} ${clientActionId}. Frames: ${JSON.stringify(frames.slice(-8))}`,
        ),
      );
    }, RUNTIME_COMMAND_TIMEOUT_MS);

    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('message', handleMessageEvent);
      socket.removeEventListener('error', handleError);
      try {
        socket.close();
      } catch {
        // Best effort cleanup after the promise has settled.
      }
    };

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    function handleOpen(): void {
      socket.send(JSON.stringify(message));
    }

    async function handleMessage(event: MessageEvent): Promise<void> {
      const parsed = parseFrame(await frameText(event.data));
      if (!parsed) {
        return;
      }
      frames.push(parsed);

      if (
        parsed['kind'] === 'command_ack' &&
        parsed['clientActionId'] === clientActionId &&
        parsed['status'] !== 'duplicate'
      ) {
        fail(
          new Error(
            `Runtime command ${clientActionId} was rejected: ${JSON.stringify(parsed['error'] ?? parsed)}`,
          ),
        );
        return;
      }

      if (parsed['kind'] !== 'patch.v2' || parsed['ackClientActionId'] !== clientActionId) {
        return;
      }

      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({
        clientActionId,
        version: Math.max(1, Number(parsed['version'] ?? 1)),
        patch: parsed,
        frames,
      });
    }

    function handleError(): void {
      fail(new Error(`Runtime WebSocket failed for ${clientActionId}.`));
    }

    const handleMessageEvent = (event: MessageEvent): void => {
      void handleMessage(event);
    };

    socket.addEventListener('open', handleOpen);
    socket.addEventListener('message', handleMessageEvent);
    socket.addEventListener('error', handleError);
  });
}

async function runtimeWebSocketUrl(
  request: APIRequestContext,
  gameId: string,
  token: string,
): Promise<string> {
  const response = await request.post(`${API_BASE_URL}/games/${gameId}/websocket-ticket`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  await expectApiOk(response, 'create runtime websocket ticket');
  const payload = (await response.json()) as RuntimeTicketPayload;
  if (payload.route !== 'runtime_ws') {
    throw new Error(
      `Expected runtime_ws route for gameplay command, got ${payload.route ?? 'null'}.`,
    );
  }
  if (typeof payload.websocketUrl !== 'string' || payload.websocketUrl.trim() === '') {
    throw new Error('WebSocket ticket response did not include websocketUrl.');
  }

  return payload.websocketUrl;
}

async function frameText(data: unknown): Promise<string> {
  if (typeof data === 'string') {
    return data;
  }
  if (data instanceof Blob) {
    return data.text();
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }

  return String(data);
}

function parseFrame(payload: string): JsonObject | null {
  try {
    const parsed = JSON.parse(payload) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : null;
  } catch {
    return null;
  }
}

function runtimeActionId(type: string): string {
  return `runtime-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function expectApiOk(response: APIResponse, action: string): Promise<void> {
  if (response.ok()) {
    return;
  }

  throw new Error(`Failed to ${action}. HTTP ${response.status()}: ${await response.text()}`);
}
