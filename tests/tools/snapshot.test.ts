/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert';
import {describe, it} from 'node:test';

import {McpResponse} from '../../src/McpResponse.js';
import {
  takeChangeSnapshot,
  takeSnapshot,
  waitFor,
} from '../../src/tools/snapshot.js';
import {html, withBrowser} from '../utils.js';

describe('snapshot', () => {
  describe('browser_snapshot', () => {
    it('includes a snapshot', async () => {
      await withBrowser(async (response, context) => {
        await takeSnapshot.handler({params: {}}, response, context);
        assert.ok(response.includeSnapshot);
      });
    });
  });
  describe('browser_wait_for', () => {
    it('should work', async () => {
      await withBrowser(async (response, context) => {
        const page = await context.getSelectedPage();

        await page.setContent(
          html`<main><span>Hello</span><span> </span><div>World</div></main>`,
        );
        await waitFor.handler(
          {
            params: {
              text: 'Hello',
            },
          },
          response,
          context,
        );

        assert.equal(
          response.responseLines[0],
          'Element with text "Hello" found.',
        );
        assert.ok(response.includeSnapshot);
      });
    });
    it('should work with element that show up later', async () => {
      await withBrowser(async (response, context) => {
        const page = context.getSelectedPage();

        const handlePromise = waitFor.handler(
          {
            params: {
              text: 'Hello World',
            },
          },
          response,
          context,
        );

        await page.setContent(
          html`<main><span>Hello</span><span> </span><div>World</div></main>`,
        );

        await handlePromise;

        assert.equal(
          response.responseLines[0],
          'Element with text "Hello World" found.',
        );
        assert.ok(response.includeSnapshot);
      });
    });
    it('should work with aria elements', async () => {
      await withBrowser(async (response, context) => {
        const page = context.getSelectedPage();

        await page.setContent(
          html`<main><h1>Header</h1><div>Text</div></main>`,
        );

        await waitFor.handler(
          {
            params: {
              text: 'Header',
            },
          },
          response,
          context,
        );

        assert.equal(
          response.responseLines[0],
          'Element with text "Header" found.',
        );
        assert.ok(response.includeSnapshot);
      });
    });

    it('should work with iframe content', async () => {
      await withBrowser(async (response, context) => {
        const page = await context.getSelectedPage();

        await page.setContent(
          html`<h1>Top level</h1>
            <iframe srcdoc="<p>Hello iframe</p>"></iframe>`,
        );

        await waitFor.handler(
          {
            params: {
              text: 'Hello iframe',
            },
          },
          response,
          context,
        );

        assert.equal(
          response.responseLines[0],
          'Element with text "Hello iframe" found.',
        );
        assert.ok(response.includeSnapshot);
      });
    });
  });

  describe('take_change_snapshot', () => {
    it('creates a baseline when none exist', async () => {
      await withBrowser(async (_response, context) => {
        const page = await context.getSelectedPage();
        await page.setContent(
          html`<main>
            <button
              id="toggle"
              aria-pressed="false"
              >Toggle</button
            >
          </main>`,
        );

        const response = new McpResponse();
        await takeChangeSnapshot.handler({params: {}}, response, context);

        assert.ok(
          response.responseLines[0].includes('No baseline found for key'),
        );
        assert.ok(context.getAccessibilityBaseline('default'));
      });
    });

    it('reports changes between snapshots without returning the full tree', async () => {
      await withBrowser(async (_response, context) => {
        const page = await context.getSelectedPage();
        await page.setContent(
          html`<main>
            <button
              id="toggle"
              aria-pressed="false"
              >Toggle</button
            >
            <section
              id="messages"
              role="log"
            ></section>
          </main>`,
        );

        const baselineResponse = new McpResponse();
        await takeChangeSnapshot.handler(
          {
            params: {
              baselineKey: 'chat',
            },
          },
          baselineResponse,
          context,
        );

        await page.evaluate(() => {
          const button = document.getElementById('toggle');
          button?.setAttribute('aria-pressed', 'true');
          const container = document.getElementById('messages');
          if (container) {
            const alert = document.createElement('div');
            alert.setAttribute('role', 'alert');
            alert.textContent = 'New socket message!';
            container.append(alert);
          }
        });

        const diffResponse = new McpResponse();
        await takeChangeSnapshot.handler(
          {
            params: {
              baselineKey: 'chat',
              replaceBaseline: false,
            },
          },
          diffResponse,
          context,
        );

        const lines = diffResponse.responseLines.join('\n');
        assert.ok(
          lines.includes('Accessibility changes compared to baseline "chat":'),
        );
        assert.ok(lines.includes('Added nodes:'));
        assert.ok(lines.includes('Changed nodes:'));
        assert.ok(lines.includes('pressed: false -> true'));
        assert.ok(lines.includes('New socket message!'));
        assert.ok(!diffResponse.includeSnapshot);
      });
    });
  });
});
