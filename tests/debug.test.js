import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserFromBrands, browserName, describeTiming, estimateBackend, formatDebugInfo } from '../src/debug.js';

test('debug info is plain text, one section per block, empty values left out', () => {
  const text = formatDebugInfo([
    ['Titl', [['version', '0.1.18'], ['id', '']]],
    ['Helper', [['runs on', 'CPU'], ['threads', null]]],
    ['Session', []],
  ]);
  assert.equal(text, '[Titl]\nversion: 0.1.18\n\n[Helper]\nruns on: CPU\n\n[Session]\n-');
});

test('request timing reads as seconds and a real-time ratio', () => {
  assert.equal(describeTiming({ audioSec: 8, requestMs: 16000 }), '16.0 s for 8.0 s of audio (2.00× real time)');
  assert.equal(describeTiming(null), null);
});

test('browser name and version come from the user agent', () => {
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7600.12 Safari/537.36';
  assert.equal(browserName(chrome), 'Chrome 150.0.7600.12');
  assert.equal(browserName(`${chrome} Edg/150.0.3000.5`), 'Edge 150.0.3000.5');
});

test('the full browser version comes from the brand list, preferring the real browser over Chromium', () => {
  const chrome = [{ brand: 'Not.A/Brand', version: '99.0.0.0' }, { brand: 'Chromium', version: '157.0.7660.4' }, { brand: 'Google Chrome', version: '157.0.7660.4' }];
  assert.equal(browserFromBrands(chrome), 'Chrome 157.0.7660.4');
  assert.equal(browserFromBrands([...chrome, { brand: 'Microsoft Edge', version: '157.0.3100.2' }]), 'Edge 157.0.3100.2');
  assert.equal(browserFromBrands([]), null);
  assert.equal(browserFromBrands(undefined), null);
});

test('without the new helper, CPU or GPU is estimated from speed and says so', () => {
  assert.match(estimateBackend({ audioSec: 8.9, requestMs: 400 }), /^probably GPU \(estimated from speed, 0\.04× real time; update the helper/);
  assert.match(estimateBackend({ audioSec: 8, requestMs: 16000 }), /^probably CPU \(estimated from speed, 2\.00× real time/);
  assert.match(estimateBackend({ audioSec: 10, requestMs: 3000 }), /^unclear \(estimated from speed, 0\.30×/);
  assert.match(estimateBackend(null), /^unknown: start subtitles once/);
});
