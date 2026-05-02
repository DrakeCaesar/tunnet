import { dstWikiMaskForRecoveredSend } from "./packet-header-format.js";
import {
  packetProfileUsesWikiSendsToFanOut,
  type RecoveredDecision,
} from "./recovered-endpoint-scheduler.js";

export function matchWikiMask(mask: string, candidate: string): boolean {
  const m = mask.split(".");
  const c = candidate.split(".");
  if (m.length !== 4 || c.length !== 4) {
    return false;
  }
  for (let i = 0; i < 4; i += 1) {
    if (m[i] === "*") continue;
    if (m[i] !== c[i]) return false;
  }
  return true;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Expand wiki `sends_to` masks against the wiki address inventory (same as edge-compare / builder compile). */
export function expandedDestinationsForEndpoint(
  srcAddress: string,
  sendsToMasks: readonly string[],
  allWikiAddresses: readonly string[],
): string[] {
  const dests = new Set<string>();
  for (const mask of sendsToMasks) {
    for (const candidate of allWikiAddresses) {
      if (candidate === srcAddress) continue;
      if (matchWikiMask(mask, candidate)) dests.add(candidate);
    }
  }
  return [...dests].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Concrete destination IPs for one recovered send decision, intersected with wiki `sends_to` expansion.
 * Matches `collectRecoveredEdgesForTick` in `compare-endpoint-edges.ts`.
 */
export function destinationsForRecoveredDecision(
  endpointAddress: string,
  decision: RecoveredDecision,
  destinationsBySource: ReadonlyMap<string, readonly string[]>,
  allWikiAddresses: readonly string[],
): string[] {
  if (!decision.shouldSend || decision.header === null || decision.profile === null) {
    return [];
  }
  const header = decision.header;
  const profile = decision.profile;
  const sourceAllowed = destinationsBySource.get(endpointAddress) ?? [];
  const matched = packetProfileUsesWikiSendsToFanOut(profile)
    ? sourceAllowed.filter((candidate) => candidate !== endpointAddress)
    : allWikiAddresses.filter(
        (candidate) =>
          candidate !== endpointAddress &&
          matchWikiMask(dstWikiMaskForRecoveredSend(endpointAddress, header, profile), candidate) &&
          sourceAllowed.includes(candidate),
      );
  return matched;
}

export function buildWikiDestinationMaps(endpointRows: readonly { address: string; sends_to: string[] }[]): {
  allWikiAddresses: string[];
  destinationsBySource: Map<string, string[]>;
} {
  const allWikiAddresses = uniqueSorted(endpointRows.map((r) => r.address));
  const destinationsBySource = new Map<string, string[]>();
  for (const row of endpointRows) {
    destinationsBySource.set(
      row.address,
      expandedDestinationsForEndpoint(row.address, row.sends_to, allWikiAddresses),
    );
  }
  return { allWikiAddresses, destinationsBySource };
}
