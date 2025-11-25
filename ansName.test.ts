import { describe, expect, it } from 'vitest';
import { formatAnsName, parseAnsName } from '../services/ans/ansName';

describe('parseAnsName', () => {
  it('parses well-formed ANS names with extension', () => {
    const result = parseAnsName('a2a://sunrise.homerepair.sunrisehomes.v1.4.3.az1');
    expect(result).toEqual({
      protocol: 'a2a',
      agentId: 'sunrise',
      capability: 'homerepair',
      provider: 'sunrisehomes',
      version: '1.4.3',
      extension: 'az1',
    });
  });

  it('normalizes protocol casing and handles names without extension', () => {
    const result = parseAnsName('MCP://instabeauty.appointments.instabeauty.v2.1.0');
    expect(result.protocol).toBe('mcp');
    expect(result.extension).toBeUndefined();
  });

  it('throws when ANS name is missing required parts', () => {
    expect(() => parseAnsName('invalid-format')).toThrow();
    expect(() => parseAnsName('a2a://agent.capability.provider')).toThrow();
    expect(() => parseAnsName('a2a://agent.capability.provider.v1.0')).toThrow();
  });

  it('requires semantic versioning', () => {
    expect(() => parseAnsName('a2a://agent.capability.provider.v1.a.0')).toThrow('semantic versioning');
  });
});

describe('formatAnsName', () => {
  it('reconstructs the ANS string with optional extension', () => {
    const formatted = formatAnsName({
      protocol: 'mcp',
      agentId: 'agent',
      capability: 'capability',
      provider: 'provider',
      version: '3.0.1',
      extension: 'prod',
    });
    expect(formatted).toBe('mcp://agent.capability.provider.v3.0.1.prod');
  });
});
