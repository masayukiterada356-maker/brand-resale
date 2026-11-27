import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto';
import { vapidAuth } from '../src/push.js';

test('通知の署名（VAPID）：Appleなどが確かめられる正しい形', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString('base64url');
  const env = { VAPID_PRIVATE_JWK: JSON.stringify(privateKey.export({ format: 'jwk' })), VAPID_PUBLIC: raw };
  const h = await vapidAuth(env, 'https://web.push.apple.com/QWERTY');
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
  assert.ok(m, h);
  const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString());
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 24 * 3600);
  assert.equal(m[4], raw);
  const ok = verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: createPublicKey({ key: pub, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url'));
  assert.ok(ok, '署名が正しくありません');
});
