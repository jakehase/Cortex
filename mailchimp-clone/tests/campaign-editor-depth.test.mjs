import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createTempDataDir, request, loginAsSeededOwner } from './helpers.mjs';

async function boot() {
  const dir = createTempDataDir();
  process.env.MAILCLONE_DATA_DIR = dir;
  const server = createServer();
  const address = await server.start({ port: 0 });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('campaign editor supports presets, settings, and snapshot restore', async () => {
  const { server, baseUrl } = await boot();
  try {
    const { jar, campaignId } = await loginAsSeededOwner(baseUrl);

    let res = await request(baseUrl, jar, `/campaigns/${campaignId}/editor`);
    let html = await res.text();
    assert.match(html, /Builder palette/);
    assert.match(html, /Guided layouts/);
    assert.match(html, /Campaign design system/);
    assert.match(html, /Draft checkpoints/);
    assert.match(html, /Editor readiness/);
    assert.match(html, /Narrative outline/);

    await request(baseUrl, jar, `/campaigns/${campaignId}/editor/add-block`, {
      method: 'POST',
      body: new URLSearchParams({ type: 'button', preset: 'promo' })
    });

    await request(baseUrl, jar, `/campaigns/${campaignId}/editor/settings`, {
      method: 'POST',
      body: new URLSearchParams({ brandTone: 'editorial', audienceAngle: 'education', layoutDensity: 'airy', heroStyle: 'story-led' })
    });

    res = await request(baseUrl, jar, `/campaigns/${campaignId}/editor`);
    html = await res.text();
    assert.match(html, /editorial/);
    assert.match(html, /education/);
    assert.match(html, /story-led/);
    assert.match(html, /Shop now/);

    await request(baseUrl, jar, `/campaigns/${campaignId}/editor/apply-layout`, {
      method: 'POST',
      body: new URLSearchParams({ preset: 'launch_story', mode: 'replace' })
    });

    res = await request(baseUrl, jar, `/campaigns/${campaignId}/editor`);
    html = await res.text();
    assert.match(html, /Launch story/);
    assert.match(html, /Score:/);
    assert.match(html, /Launch hero/);
    assert.match(html, /Primary CTA/);
    assert.match(html, /Support footer/);
    assert.match(html, /Review the launch/);

    const snapshots = [...html.matchAll(/restore-snapshot\/([^"/]+)/g)].map((m) => m[1]);
    assert.ok(snapshots.length >= 2);

    await request(baseUrl, jar, `/campaigns/${campaignId}/editor/block/0/update`, {
      method: 'POST',
      body: new URLSearchParams({
        sectionName: 'Offer section',
        eyebrow: 'LIMITED DROP',
        title: 'Launch day offer',
        body: 'Updated promo copy',
        stylePreset: 'promo',
        alignment: 'center',
        backgroundColor: '#eef4ff',
        textColor: '#18212f',
        padding: '24px',
        buttonLabel: 'Claim offer',
        buttonUrl: 'https://example.test/offer',
        buttonStyle: 'secondary'
      })
    });

    res = await request(baseUrl, jar, `/campaigns/${campaignId}/editor`);
    html = await res.text();
    assert.match(html, /Offer section/);
    assert.match(html, /Claim offer/);

    const restoreTarget = snapshots[snapshots.length - 1];
    await request(baseUrl, jar, `/campaigns/${campaignId}/editor/restore-snapshot/${restoreTarget}`, { method: 'POST' });

    res = await request(baseUrl, jar, `/campaigns/${campaignId}/editor`);
    html = await res.text();
    assert.match(html, /Manual checkpoint|Updated editor settings|Added promo block/);
  } finally {
    await server.stop();
    delete process.env.MAILCLONE_DATA_DIR;
  }
});
