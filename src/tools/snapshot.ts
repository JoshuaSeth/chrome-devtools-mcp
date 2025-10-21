/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Locator} from 'puppeteer-core';

import {zod} from '../third_party/modelcontextprotocol-sdk/index.js';
import {
  diffSnapshots,
  hasSnapshotChanges,
  normalizeSnapshot,
  type NormalizedAXNode,
  type NodeChange,
} from '../utils/accessibilityDiff.js';

import {ToolCategories} from './categories.js';
import {defineTool, timeoutSchema} from './ToolDefinition.js';

export const takeSnapshot = defineTool({
  name: 'take_snapshot',
  description: `Take a text snapshot of the currently selected page based on the a11y tree. The snapshot lists page elements along with a unique
identifier (uid). Always use the latest snapshot. Prefer taking a snapshot over taking a screenshot.`,
  annotations: {
    category: ToolCategories.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    verbose: zod
      .boolean()
      .optional()
      .describe(
        'Whether to include all possible information available in the full a11y tree. Default is false.',
      ),
  },
  handler: async (request, response) => {
    response.setIncludeSnapshot(true, request.params.verbose ?? false);
  },
});

export const waitFor = defineTool({
  name: 'wait_for',
  description: `Wait for the specified text to appear on the selected page.`,
  annotations: {
    category: ToolCategories.NAVIGATION_AUTOMATION,
    readOnlyHint: true,
  },
  schema: {
    text: zod.string().describe('Text to appear on the page'),
    ...timeoutSchema,
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    const frames = page.frames();

    const locator = Locator.race(
      frames.flatMap(frame => [
        frame.locator(`aria/${request.params.text}`),
        frame.locator(`text/${request.params.text}`),
      ]),
    );

    if (request.params.timeout) {
      locator.setTimeout(request.params.timeout);
    }

    await locator.wait();

    response.appendResponseLine(
      `Element with text "${request.params.text}" found.`,
    );

    response.setIncludeSnapshot(true);
  },
});

export const takeChangeSnapshot = defineTool({
  name: 'take_change_snapshot',
  description:
    'Capture accessibility (AX) changes compared to a stored baseline and report only the differences. Use this when you are polling dynamic views—think WebSocket chats, live dashboards, or any SPA regions that refresh while you wait—to confirm that expected elements appeared or attributes flipped without flooding the context with the entire tree.',
  annotations: {
    category: ToolCategories.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    baselineKey: zod
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Identifier used to store the baseline snapshot. Defaults to "default".',
      ),
    replaceBaseline: zod
      .boolean()
      .optional()
      .describe(
        'Whether to replace the stored baseline with the latest snapshot. Defaults to true.',
      ),
    compareTo: zod
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Compare against a different baseline key. When omitted, compares against the same key as baselineKey.',
      ),
  },
  handler: async (request, response, context) => {
    const baselineKey = request.params.baselineKey?.trim() || 'default';
    const compareKey = request.params.compareTo?.trim() || baselineKey;
    const replaceBaseline = request.params.replaceBaseline ?? true;

    const snapshot = await context.captureAccessibilitySnapshot();
    if (!snapshot) {
      response.appendResponseLine(
        'Unable to capture accessibility snapshot for the current page.',
      );
      return;
    }

    const normalizedSnapshot = normalizeSnapshot(snapshot);
    const baseline = context.getAccessibilityBaseline(compareKey);

    if (!baseline) {
      context.setAccessibilityBaseline(baselineKey, normalizedSnapshot);
      response.appendResponseLine(
        `No baseline found for key "${compareKey}". Created a baseline with the current snapshot.`,
      );
      return;
    }

    const diff = diffSnapshots(baseline, normalizedSnapshot);

    if (!hasSnapshotChanges(diff)) {
      response.appendResponseLine(
        `No accessibility changes compared to baseline "${compareKey}".`,
      );
    } else {
      response.appendResponseLine(
        `Accessibility changes compared to baseline "${compareKey}":`,
      );
      response.appendResponseLine(
        `Added nodes: ${diff.added.length}, Removed nodes: ${diff.removed.length}, Changed nodes: ${diff.changed.length}`,
      );

      if (diff.added.length) {
        response.appendResponseLine('## Added');
        for (const node of diff.added) {
          response.appendResponseLine(`- ${formatNodeSummary(node)}`);
        }
      }
      if (diff.removed.length) {
        response.appendResponseLine('## Removed');
        for (const node of diff.removed) {
          response.appendResponseLine(`- ${formatNodeSummary(node)}`);
        }
      }
      if (diff.changed.length) {
        response.appendResponseLine('## Changed');
        for (const change of diff.changed) {
          response.appendResponseLine(`- ${formatChangeSummary(change)}`);
          for (const detail of change.changes) {
            response.appendResponseLine(
              `  - ${detail.property}: ${formatDiffValue(detail.before)} -> ${formatDiffValue(detail.after)}`,
            );
          }
        }
      }
    }

    if (replaceBaseline) {
      context.setAccessibilityBaseline(baselineKey, normalizedSnapshot);
    }
  },
});

function formatNodeSummary(node: NormalizedAXNode): string {
  const role = node.role ? `[${node.role}]` : '[unknown role]';
  const name = node.name ? ` "${node.name}"` : '';
  return `${role}${name} at path ${node.path}`;
}

function formatChangeSummary(change: NodeChange): string {
  const role = change.role ? `[${change.role}]` : '[unknown role]';
  const name = change.name ? ` "${change.name}"` : '';
  return `${role}${name} at path ${change.path}`;
}

function formatDiffValue(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
