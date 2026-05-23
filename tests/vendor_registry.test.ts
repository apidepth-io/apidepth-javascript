import { describe, it, expect, beforeEach } from 'vitest';
import { VendorRegistry, BUNDLED_BASELINE } from '../src/vendor_registry.js';

beforeEach(() => {
  // Reset to bundled baseline before each test
  VendorRegistry.replace(BUNDLED_BASELINE);
});

describe('VendorRegistry.identify', () => {
  it('returns null for unknown host', () => {
    expect(VendorRegistry.identify('unknown.example.com', '/v1/foo')).toBeNull();
  });

  it('identifies Stripe', () => {
    const result = VendorRegistry.identify('api.stripe.com', '/v1/charges/ch_abc123');
    expect(result).toEqual(['stripe', '/v1/charges/:id']);
  });

  it('identifies OpenAI chat completions', () => {
    expect(VendorRegistry.identify('api.openai.com', '/v1/chat/completions')).toEqual(
      ['openai', '/v1/chat/completions'],
    );
  });

  it('identifies Anthropic messages', () => {
    expect(VendorRegistry.identify('api.anthropic.com', '/v1/messages')).toEqual(
      ['anthropic', '/v1/messages'],
    );
  });

  it('identifies GitHub repos endpoint', () => {
    expect(VendorRegistry.identify('api.github.com', '/repos/owner/myrepo')).toEqual(
      ['github', '/repos/:owner/:repo'],
    );
  });

  it('strips query strings before normalizing', () => {
    const result = VendorRegistry.identify('api.stripe.com', '/v1/charges/ch_abc?expand[]=balance_transaction');
    expect(result).toEqual(['stripe', '/v1/charges/:id']);
  });

  it('applies generic UUID normalizer', () => {
    VendorRegistry.loadExtraVendors({ 'my-api': 'api.myservice.internal' });
    const result = VendorRegistry.identify('api.myservice.internal', '/users/550e8400-e29b-41d4-a716-446655440000');
    expect(result?.[1]).toBe('/users/:uuid');
  });

  it('applies generic numeric ID normalizer', () => {
    VendorRegistry.loadExtraVendors({ 'my-api': 'api.myservice.internal' });
    expect(VendorRegistry.identify('api.myservice.internal', '/orders/12345')?.[1]).toBe('/orders/:id');
  });
});

describe('VendorRegistry.replace', () => {
  it('replaces the live registry atomically', () => {
    VendorRegistry.replace({
      version: 'test-v1',
      vendors: { 'testvendor': { hosts: ['api.testvendor.io'], patterns: [] } },
    });
    expect(VendorRegistry.identify('api.testvendor.io', '/foo')).toEqual(['testvendor', '/foo']);
    expect(VendorRegistry.identify('api.stripe.com', '/v1/charges')).toBeNull();
  });

  it('preserves extra_vendors across a replace', () => {
    VendorRegistry.loadExtraVendors({ 'internal': 'api.internal.example.com' });
    VendorRegistry.replace(BUNDLED_BASELINE, { 'internal': 'api.internal.example.com' });
    expect(VendorRegistry.identify('api.internal.example.com', '/health')).toEqual(
      ['internal', '/health'],
    );
  });
});

describe('VendorRegistry metadata', () => {
  it('reports correct version', () => {
    expect(VendorRegistry.version).toBe('bundled');
  });

  it('reports non-zero vendor count', () => {
    expect(VendorRegistry.vendorCount).toBeGreaterThan(0);
  });
});

describe('VendorRegistry unsafe pattern guard', () => {
  it('skips patterns with unsafe constructs without throwing', () => {
    expect(() => VendorRegistry.replace({
      version: 'unsafe-test',
      vendors: {
        bad: {
          hosts: ['bad.example.com'],
          patterns: [{ match: '(?{code})', replace: '/bad' }],
        },
      },
    })).not.toThrow();
    // Host is still registered, just without the bad pattern
    expect(VendorRegistry.identify('bad.example.com', '/anything')).toEqual(['bad', '/anything']);
  });
});
