import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOnBattery } from '../src/battery.js';

test('isOnBattery: returns boolean', () => {
  const result = isOnBattery();
  assert.equal(typeof result, 'boolean');
});
