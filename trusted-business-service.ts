/**
 * Trusted Business Service - Manages ANS Business Marketplace
 *
 * Fetches verified GoDaddy customer businesses from ANS API
 * Provides search, filtering, and validation capabilities
 */

export interface ANSBusinessService {
  id: string;
  name: string;
  description?: string;
  capability?: string; // Agent capability from API (e.g., "Customer Service", "Booking")
  location?: string;
  url: string; // MCP endpoint URL
  website?: string;
  phone?: string;
  logo?: string;
  rating?: number;
  connectionCount?: number;
  availableServices?: string[];
  verified: boolean;
}

const API_URL = 'https://ra.int.dev-godaddy.com/v1/agents';
const DEFAULT_LIMIT = 100; // Fetch 100 at a time

// Cache-related code removed per user request
// Cache functions kept below for potential future use but not actively used

/**
 * Fetch trusted businesses from ANS API
 * Always fetches fresh data without caching
 */
export async function fetchTrustedBusinesses(authToken?: string): Promise<ANSBusinessService[]> {
  try {
    console.log('🔄 Fetching trusted agents from ANS API...');

    // Fetch with pagination to get all agents
    const allBusinesses: ANSBusinessService[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const url = `${API_URL}?limit=${DEFAULT_LIMIT}&offset=${offset}`;
      console.log(`📡 Fetching agents: offset=${offset}, limit=${DEFAULT_LIMIT}`);

      const headers: Record<string, string> = {
        'accept': 'application/json',
      };

      // Add Authorization header if token is provided
      if (authToken) {
        // Clean the token - remove "Bearer " prefix if user accidentally included it
        const cleanToken = authToken.trim().replace(/^Bearer\s+/i, '');
        headers['Authorization'] = `Bearer ${cleanToken}`;
        console.log('🔑 Using provided ANS API token');
      }

      const response = await fetch(url, {
        method: 'GET',
        headers,
        credentials: 'include', // Send cookies with the request
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error(`Authentication failed (${response.status}): Please provide a valid ANS API token in Settings`);
        }
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`📦 API response (page ${offset / DEFAULT_LIMIT + 1}):`, data);

      // Parse this page of results
      const businesses = parseAPIResponse(data);
      allBusinesses.push(...businesses);

      // Check if there are more pages
      hasMore = data.hasMore === true;
      offset += DEFAULT_LIMIT;

      console.log(`📊 Fetched ${businesses.length} agents (total so far: ${allBusinesses.length}/${data.totalCount || '?'})`);

      // No limit - fetch all available agents
    }

    console.log(`✅ Fetched ${allBusinesses.length} total agents from ANS`);
    return allBusinesses;

  } catch (error) {
    console.error('❌ Failed to fetch trusted businesses:', error);
    // Return empty array on error
    return [];
  }
}

/**
 * Parse API response to our business format
 * Response structure: { agents: [...], totalCount, returnedCount, hasMore, ... }
 */
function parseAPIResponse(data: any): ANSBusinessService[] {
  if (!data || !data.agents || !Array.isArray(data.agents)) {
    console.warn('⚠️  Invalid API response structure:', data);
    return [];
  }

  return data.agents.map((agent: any) => {
    // Extract the MCP URL from protocolExtensions.mcp.remotes[0].url
    let mcpUrl = '';

    try {
      // Check the correct path: protocolExtensions.mcp.remotes[0].url
      if (agent.protocolExtensions?.mcp?.remotes?.[0]?.url) {
        mcpUrl = agent.protocolExtensions.mcp.remotes[0].url;
      }
      // Fallback to old path for backwards compatibility
      else if (agent.protocolExtensions?.acp?.url) {
        mcpUrl = agent.protocolExtensions.acp.url;
      }
      // Last resort fallback
      else if (agent.endpoint) {
        mcpUrl = agent.endpoint;
      }
    } catch (error) {
      console.warn(`⚠️  Error extracting URL for ${agent.agentName}:`, error);
      mcpUrl = '';
    }

    // The URL should already be in the correct format: https://xxx.agenthost.club/mcp
    // But log it for debugging
    console.log(`📍 MCP URL for ${agent.agentName || 'unknown'}: ${mcpUrl}`);

    const agentId = agent.ansName || agent.agentName || '';
    const agentCapability = agent.agentCapability || 'Other';

    // Log agents with missing or unusual capabilities
    if (!agent.agentCapability) {
      console.warn(`⚠️  Agent "${agent.agentName}" (${agentId}) has no agentCapability field`);
    }

    return {
      id: agentId,
      name: agent.agentName || 'Unknown Agent',
      description: `${agentCapability} service provided by ${agent.provider || 'provider'}`,
      capability: agentCapability, // Map agentCapability to capability field
      location: '', // Not provided in API
      url: mcpUrl, // Now using https:// scheme
      website: '', // Not provided in API
      phone: '', // Not provided in API
      logo: '', // Not provided in API
      rating: 0, // Not provided in API
      connectionCount: 0, // Not provided in API
      availableServices: [], // Would need to fetch from agent-details link
      verified: true, // All from ANS API are verified
    };
  });
}

// ============================================
// CACHE FUNCTIONS - DISABLED PER USER REQUEST
// Keeping for reference but not actively used
// ============================================

/*
// Cache-related interfaces and constants
interface CachedBusinessData {
  businesses: ANSBusinessService[];
  timestamp: number;
}
const CACHE_KEY = 'ans_trusted_businesses_cache';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function getCachedBusinesses(): Promise<ANSBusinessService[] | null> {
  try {
    const result = await chrome.storage.local.get(CACHE_KEY);
    const cached: CachedBusinessData = result[CACHE_KEY];

    if (!cached || !cached.businesses || !cached.timestamp) {
      return null;
    }

    const now = Date.now();
    if (now - cached.timestamp > CACHE_TTL) {
      console.log('🗑️  Cache expired');
      return null;
    }

    return cached.businesses;
  } catch (error) {
    console.error('❌ Error reading cache:', error);
    return null;
  }
}

async function cacheBusinesses(businesses: ANSBusinessService[]): Promise<void> {
  try {
    const cacheData: CachedBusinessData = {
      businesses,
      timestamp: Date.now(),
    };

    await chrome.storage.local.set({ [CACHE_KEY]: cacheData });
    console.log('💾 Cached businesses data');
  } catch (error) {
    console.error('❌ Error caching businesses:', error);
  }
}

export async function clearBusinessCache(): Promise<void> {
  try {
    await chrome.storage.local.remove(CACHE_KEY);
    console.log('🗑️  Cleared business cache');
  } catch (error) {
    console.error('❌ Error clearing cache:', error);
  }
}
*/

/**
 * Search businesses by name, description, capability, location, or ID
 */
export function searchBusinesses(
  businesses: ANSBusinessService[],
  query: string
): ANSBusinessService[] {
  if (!query || query.trim() === '') {
    return businesses;
  }

  const lowerQuery = query.toLowerCase();
  return businesses.filter((business) => {
    return (
      business.id.toLowerCase().includes(lowerQuery) ||
      business.name.toLowerCase().includes(lowerQuery) ||
      business.description?.toLowerCase().includes(lowerQuery) ||
      business.capability?.toLowerCase().includes(lowerQuery) ||
      business.location?.toLowerCase().includes(lowerQuery)
    );
  });
}

/**
 * Filter businesses by capability
 */
export function filterByCapability(
  businesses: ANSBusinessService[],
  capability: string
): ANSBusinessService[] {
  if (!capability || capability === 'all') {
    return businesses;
  }

  return businesses.filter((business) =>
    business.capability?.toLowerCase() === capability.toLowerCase()
  );
}

/**
 * Get all unique capabilities from businesses (populated from API agentCapability field)
 */
export function getCapabilities(businesses: ANSBusinessService[]): string[] {
  const capabilities = new Set<string>();

  businesses.forEach((business) => {
    if (business.capability) {
      capabilities.add(business.capability);
    }
  });

  return Array.from(capabilities).sort();
}

/**
 * Validate if a URL is a trusted business
 */
export function isTrustedBusiness(
  url: string,
  trustedBusinesses: ANSBusinessService[]
): boolean {
  return trustedBusinesses.some((business) => business.url === url);
}

/**
 * Get business by ID
 */
export function getBusinessById(
  id: string,
  businesses: ANSBusinessService[]
): ANSBusinessService | undefined {
  return businesses.find((business) => business.id === id);
}

/**
 * Get business by URL
 */
export function getBusinessByUrl(
  url: string,
  businesses: ANSBusinessService[]
): ANSBusinessService | undefined {
  return businesses.find((business) => business.url === url);
}

/**
 * Sort businesses by different criteria
 */
export function sortBusinesses(
  businesses: ANSBusinessService[],
  sortBy: 'name' | 'rating' | 'connections' | 'recent' = 'name'
): ANSBusinessService[] {
  const sorted = [...businesses];

  switch (sortBy) {
    case 'name':
      return sorted.sort((a, b) => a.name.localeCompare(b.name));

    case 'rating':
      return sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));

    case 'connections':
      return sorted.sort((a, b) => (b.connectionCount || 0) - (a.connectionCount || 0));

    case 'recent':
      // TODO: Add timestamp to business data if available
      return sorted;

    default:
      return sorted;
  }
}

/**
 * Get popular/featured businesses (top by connections)
 */
export function getFeaturedBusinesses(
  businesses: ANSBusinessService[],
  limit = 6
): ANSBusinessService[] {
  return sortBusinesses(businesses, 'connections').slice(0, limit);
}
