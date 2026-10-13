import {test} from 'node:test';
import assert from 'node:assert/strict';
import {downloadTotal} from '../src/download-progress.mjs';

function headers(length, encoding) {
  const result = new Headers();
  if (length !== undefined) result.set('content-length', length);
  if (encoding !== undefined) result.set('content-encoding', encoding);
  return result;
}

test('compressed or unknown encodings never use Content-Length as decoded total', () => {
  for (const encoding of ['gzip', 'br', 'deflate', 'zstd', 'GZIP', 'gzip, br', 'identity, gzip', '']) {
    assert.equal(downloadTotal(headers('430692084', encoding)), 0, encoding);
  }
});

test('absent or identity encoding accepts positive safe integer lengths', () => {
  for (const encoding of [undefined, 'identity', 'IDENTITY', ' identity ']) {
    for (const length of ['1', '469927196', '00012', ' 42 ', String(Number.MAX_SAFE_INTEGER)]) {
      assert.equal(downloadTotal(headers(length, encoding)), Number(length));
    }
  }
});

test('missing, zero, malformed, negative, or unsafe lengths are unknown', () => {
  for (const length of [undefined, '', ' ', '0', '000', '-1', '+1', '1.5', '1e3', '0x10',
    'NaN', 'Infinity', '12px', '12, 12', '1 2', '9007199254740992', '999999999999999999999999']) {
    for (const encoding of [undefined, 'identity']) {
      assert.equal(downloadTotal(headers(length, encoding)), 0, String(length));
    }
  }
});

test('identity total is retained through completion and discarded if bytes exceed it', () => {
  const responseHeaders = headers('100', 'identity');
  assert.equal(downloadTotal(responseHeaders, 0), 100);
  assert.equal(downloadTotal(responseHeaders, 99), 100);
  assert.equal(downloadTotal(responseHeaders, 100), 100);
  assert.equal(downloadTotal(responseHeaders, 101), 0);
});

test('observed Pages transfer keeps decoded byte count with an unknown compressed total', () => {
  const loaded = 469927196;
  const compressedLength = '430692084';
  for (const encoding of ['gzip', 'br']) {
    const responseHeaders = headers(compressedLength, encoding);
    assert.equal(downloadTotal(responseHeaders), 0);
    assert.equal(downloadTotal(responseHeaders, 200000000), 0);
    assert.deepEqual({loaded, total: downloadTotal(responseHeaders, loaded)}, {loaded: 469927196, total: 0});
  }
  // Also tolerate a server exposing an incorrect unencoded length.
  assert.equal(downloadTotal(headers(compressedLength), loaded), 0);
});
