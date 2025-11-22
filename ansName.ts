export interface ParsedAnsName {
  protocol: string;
  agentId: string;
  capability: string;
  provider: string;
  version: string;
  extension?: string;
}

const ANS_PATTERN = /^([a-z0-9]+):\/\/([a-z0-9][a-z0-9-]*)\.([a-z0-9][a-z0-9-]*)\.([a-z0-9][a-z0-9-]*)\.v([a-z0-9]+)\.([a-z0-9]+)\.([a-z0-9]+)(?:\.([a-z0-9][a-z0-9-]*))?$/i;
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseAnsName(ansName: string): ParsedAnsName {
  const trimmed = ansName?.trim();
  if (!trimmed) {
    throw new Error('ANS name is required');
  }

  const match = trimmed.match(ANS_PATTERN);
  if (!match) {
    throw new Error('ANS name does not match protocol://agent.capability.provider.vX.Y.Z format');
  }

  const [, protocol, agentId, capability, provider, major, minor, patch, extension] = match;
  const version = `${major}.${minor}.${patch}`;

  if (!SEMVER_PATTERN.test(version)) {
    throw new Error('ANS version must follow semantic versioning (e.g., 1.0.0)');
  }

  return {
    protocol: protocol.toLowerCase(),
    agentId,
    capability,
    provider,
    version,
    extension,
  };
}

export function formatAnsName(parsed: ParsedAnsName): string {
  const base = `${parsed.protocol.toLowerCase()}://${parsed.agentId}.${parsed.capability}.${parsed.provider}.v${parsed.version}`;
  return parsed.extension ? `${base}.${parsed.extension}` : base;
}
