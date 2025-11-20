/**
 * Site Detector - Utilities for detecting current site and matching to A2A agents
 */

/**
 * Get the current tab's domain
 */
export async function getCurrentDomain(): Promise<string | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url) {
      return null;
    }

    const url = new URL(tab.url);
    return url.hostname;
  } catch (error) {
    console.error('Error getting current domain:', error);
    return null;
  }
}

/**
 * Match a domain to an A2A agent name
 * e.g., "www.godaddy.com" -> "www-godaddy-com"
 */
export function domainToAgentName(domain: string): string {
  return domain.replace(/\./g, '-');
}

/**
 * Convert agent name back to domain format
 * e.g., "www-godaddy-com" -> "www.godaddy.com"
 */
export function agentNameToDomain(agentName: string): string {
  return agentName.replace(/-/g, '.');
}

/**
 * Check if a domain matches an agent name
 * e.g., "www.godaddy.com" matches agent "www-godaddy-com"
 * Also handles:
 * - "godaddy.com" matches agent "www-godaddy-com"
 * - "www.godaddy.com" matches agent "www-godaddy-com-mcp" (prefix match)
 */
export function doesDomainMatchAgent(domain: string, agentName: string): boolean {
  console.log(`   🔍 Matching domain "${domain}" against agent "${agentName}"`);

  const normalizedDomain = domainToAgentName(domain);
  console.log(`      Normalized domain: "${normalizedDomain}"`);

  // Direct match
  if (normalizedDomain === agentName) {
    console.log(`      ✓ Direct match!`);
    return true;
  }

  // Prefix match (e.g., "www-godaddy-com" matches "www-godaddy-com-mcp")
  if (agentName.startsWith(normalizedDomain + '-')) {
    console.log(`      ✓ Prefix match! (agent has suffix: ${agentName.substring(normalizedDomain.length)})`);
    return true;
  }

  // Try with www prefix if domain doesn't have it
  if (!domain.startsWith('www.')) {
    const withWww = domainToAgentName(`www.${domain}`);
    console.log(`      Trying with www prefix: "${withWww}"`);
    if (withWww === agentName) {
      console.log(`      ✓ Match with www prefix!`);
      return true;
    }
    // Prefix match with www
    if (agentName.startsWith(withWww + '-')) {
      console.log(`      ✓ Prefix match with www prefix!`);
      return true;
    }
  }

  // Try without www prefix if domain has it
  if (domain.startsWith('www.')) {
    const withoutWww = domainToAgentName(domain.replace(/^www\./, ''));
    console.log(`      Trying without www prefix: "${withoutWww}"`);
    if (withoutWww === agentName) {
      console.log(`      ✓ Match without www prefix!`);
      return true;
    }
    // Prefix match without www
    if (agentName.startsWith(withoutWww + '-')) {
      console.log(`      ✓ Prefix match without www prefix!`);
      return true;
    }
  }

  console.log(`      ✗ No match`);
  return false;
}

/**
 * Find A2A agent for current site
 */
export async function findAgentForCurrentSite(
  registeredAgents: Array<{ serverId: string; serverName: string }>
): Promise<{ serverId: string; serverName: string } | null> {
  const currentDomain = await getCurrentDomain();

  if (!currentDomain) {
    console.log('⚠️  Could not get current domain');
    return null;
  }

  console.log(`🔍 Current domain: ${currentDomain}`);
  console.log(`   Checking against ${registeredAgents.length} registered agent(s):`);
  registeredAgents.forEach((agent) => {
    const matches = doesDomainMatchAgent(currentDomain, agent.serverName);
    console.log(`   - ${agent.serverName}: ${matches ? '✓ MATCH' : '✗ no match'}`);
  });

  const matchedAgent = registeredAgents.find((agent) =>
    doesDomainMatchAgent(currentDomain, agent.serverName)
  );

  if (matchedAgent) {
    console.log(`✅ Found A2A agent "${matchedAgent.serverName}" for site ${currentDomain}`);
  } else {
    console.log(`ℹ️  No A2A agent found for site ${currentDomain}`);
  }

  return matchedAgent || null;
}
