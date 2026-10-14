import type { Connection } from '@salesforce/core';
import type { GraphNode } from './graph.js';
import { MAX_GRAPH_NODES } from './plan.js';

export type NodeError = { referenceId: string; errorCode: string; message: string; fields: string[] };

export type GraphResult =
  | { ok: true; ids: Map<string, string> }
  | { ok: false; error: NodeError; ids: Map<string, string> };

type CompositeResponse = {
  body: unknown;
  httpStatusCode: number;
  referenceId: string;
};

type GraphResponse = {
  graphs: Array<{
    graphId: string;
    isSuccessful: boolean;
    graphResponse: { compositeResponse: CompositeResponse[] };
  }>;
};

const REF = /@\{([A-Za-z0-9_]+)\.id\}/g;

/** Replaces references to nodes of earlier graphs with their Ids. */
function substitute<T>(value: T, ids: Map<string, string>): T {
  if (typeof value === 'string') return value.replace(REF, (m: string, r: string) => ids.get(r) ?? m) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => substitute(v, ids)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = substitute(v, ids);
    return out as T;
  }
  return value;
}

/** The first real error of a failed graph. The other nodes say PROCESSING_HALTED. */
export function graphError(responses: CompositeResponse[]): NodeError {
  let halted: NodeError | undefined;
  for (const r of responses) {
    if (r.httpStatusCode < 400) continue;
    const errors = Array.isArray(r.body)
      ? (r.body as Array<{ errorCode?: string; message?: string; fields?: string[] }>)
      : [];
    const e = errors[0] ?? {};
    const error = {
      referenceId: r.referenceId,
      errorCode: e.errorCode ?? String(r.httpStatusCode),
      message: e.message ?? '',
      fields: e.fields ?? [],
    };
    if (error.errorCode !== 'PROCESSING_HALTED') return error;
    halted ??= error;
  }
  return (
    halted ?? { referenceId: '', errorCode: 'UNKNOWN', message: 'The graph failed with no error message.', fields: [] }
  );
}

/** Sends one Composite Graph. All nodes succeed, or the org rolls back all nodes. */
export async function sendGraph(conn: Connection, nodes: GraphNode[]): Promise<GraphResult> {
  const response = await conn.request<GraphResponse>({
    method: 'POST',
    url: `/services/data/v${conn.getApiVersion()}/composite/graph`,
    body: JSON.stringify({ graphs: [{ graphId: 'g1', compositeRequest: nodes }] }),
    headers: { 'Content-Type': 'application/json' },
  });
  const graph = response.graphs[0];
  const responses = graph?.graphResponse?.compositeResponse ?? [];
  const ids = new Map<string, string>();
  if (graph?.isSuccessful) {
    for (const r of responses) {
      const id = (r.body as { id?: string } | null)?.id;
      if (id) ids.set(r.referenceId, id);
    }
    return { ok: true, ids };
  }
  return { ok: false, error: graphError(responses), ids };
}

export function isLockError(result: GraphResult): boolean {
  return !result.ok && result.error.errorCode === 'UNABLE_TO_LOCK_ROW';
}

/**
 * Sends the nodes: as one graph if they fit (atomic), else as several graphs in order (not atomic, 5.6).
 * A graph that fails with UNABLE_TO_LOCK_ROW is sent one more time (5.7).
 */
export async function runNodes(
  conn: Connection,
  nodes: GraphNode[],
  maxNodes = MAX_GRAPH_NODES
): Promise<GraphResult & { graphs: number }> {
  const ids = new Map<string, string>();
  let graphs = 0;
  for (let i = 0; i < nodes.length; i += maxNodes) {
    const chunk = substitute(nodes.slice(i, i + maxNodes), ids);
    graphs++;
    // eslint-disable-next-line no-await-in-loop
    let result = await sendGraph(conn, chunk);
    // eslint-disable-next-line no-await-in-loop
    if (isLockError(result)) result = await sendGraph(conn, chunk);
    for (const [k, v] of result.ids) ids.set(k, v);
    if (!result.ok) return { ok: false, error: result.error, ids, graphs };
  }
  return { ok: true, ids, graphs };
}
