import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserFromBrands, browserName, describeLookahead, describeTiming, estimateBackend, formatDebugInfo, modelFor, modelName, serbianOffer, translateGemmaOffer } from '../src/debug.js';

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

test('lookahead debug info is empty outside a running lookahead session', () => {
  assert.deepEqual(describeLookahead({ status: 'idle' }, null), []);
  assert.deepEqual(describeLookahead({ status: 'running', mode: 'live' }, null), []);
});

test('a running lookahead session the worker forgot is reported as a problem', () => {
  const rows = describeLookahead({ status: 'running', mode: 'lookahead' }, null);
  assert.equal(rows.length, 1);
  assert.match(rows[0][1], /no lookahead session/);
});

test('lookahead debug info shows each step from scout capture to subtitles', () => {
  const now = 100_000;
  const rows = Object.fromEntries(
    describeLookahead(
      { status: 'running', mode: 'lookahead' },
      {
        startedAt: now - 60_000,
        videoId: 'abc',
        main: { time: 3, paused: true, ad: false },
        scout: { videoId: 'abc', time: 25.6, paused: false, ad: false, capture: { track: 'live', reads: 0, blocks: 0, sent: 0, recaptures: 3, error: null } },
        scoutStates: 120,
        scoutAt: now - 500,
        audioBlocks: 0,
        audioSec: 0,
        audioAt: null,
        otherVideoAudio: 0,
        coveredTo: null,
        transcriber: { requests: 0, failures: 0, silent: 0, lastError: null, buffered: 0 },
        cues: 0,
        seeks: 2,
      },
      now,
    ),
  );
  assert.equal(rows['running for'], '60.0 s');
  assert.equal(rows['main tab'], '3.0 s, paused');
  assert.equal(rows['scout tab'], '25.6 s, playing');
  assert.equal(rows['scout reports'], '120, last 0.5 s ago');
  assert.equal(rows['scout capture'], 'track live, 0 frames read, 0 blocks, 0 sent, 3 re-captures');
  assert.equal(rows['audio received'], '0 blocks, 0.0 s, last never');
  assert.equal(rows['whisper requests'], '0 sent, 0 failed, 0 silent windows skipped');
  assert.equal(rows['subtitles ready ahead'], 'none');
  assert.equal(rows['audio for another video'], null);
});

test('the Serbian model is offered only with small, sr or hr, and the model missing', () => {
  const small = { version: '0.1.21', model: '/m/ggml-small.bin', serbian_model: null };
  assert.deepEqual(serbianOffer(small, 'sr'), { show: true, model: 'not downloaded', reason: 'shown' });
  assert.equal(serbianOffer(small, 'hr').show, true);
  assert.deepEqual(serbianOffer(small, 'en'), { show: false, model: 'not downloaded', reason: 'hidden: spoken language is en, not sr or hr' });
  assert.deepEqual(serbianOffer({ ...small, serbian_model: '/m/sr.bin' }, 'sr'), { show: false, model: '/m/sr.bin', reason: 'hidden: already downloaded' });
  const turbo = serbianOffer({ version: '0.1.21', model: '/m/ggml-large-v3-turbo.bin' }, 'sr');
  assert.equal(turbo.show, false);
  assert.equal(turbo.model, 'not used with ggml-large-v3-turbo.bin (only with small)');
  assert.equal(serbianOffer({ problem: 'not installed' }, 'sr').reason, 'hidden: helper not installed');
  assert.equal(serbianOffer({}, 'sr').reason, 'hidden: helper is older than this feature');
  assert.equal(serbianOffer(null, 'sr').show, false);
});

test('the model shown is the one the helper picks for the spoken language', () => {
  const small = { version: '0.1.21', model: '/m/ggml-small.bin', serbian_model: '/m/ggml-small-sr-distill-v3-q8_0.bin' };
  assert.equal(modelFor(small, 'sr'), 'small-sr-distill-v3-q8_0');
  assert.equal(modelFor(small, 'hr'), 'small-sr-distill-v3-q8_0');
  assert.equal(modelFor(small, 'en'), 'small');
  assert.equal(modelFor(small, 'auto'), 'small');
  assert.equal(modelFor({ ...small, serbian_model: null }, 'sr'), 'small');
  assert.equal(modelFor({ version: '0.1.21', model: 'C:\\m\\ggml-large-v3-turbo.bin' }, 'sr'), 'large-v3-turbo');
  assert.equal(modelFor({ problem: 'not installed' }, 'sr'), null);
  assert.equal(modelName(undefined), null);
});

test('TranslateGemma is offered only when whisper-server runs on a GPU, unless already selected', () => {
  assert.equal(translateGemmaOffer({ backend: 'GPU (MTL0)' }, false).show, true);
  assert.equal(translateGemmaOffer({ backend: 'GPU (CUDA0)' }, false).show, true);
  assert.deepEqual(translateGemmaOffer({ backend: 'CPU' }, false), { show: false, reason: 'hidden: whisper-server runs on CPU' });
  assert.equal(translateGemmaOffer({}, false).reason, 'hidden: no GPU detected yet (start subtitles once)');
  assert.equal(translateGemmaOffer(null, false).show, false);
  assert.equal(translateGemmaOffer({ backend: 'CPU' }, true).show, true);
});
