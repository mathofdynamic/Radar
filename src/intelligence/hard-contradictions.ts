export type ExplicitLocationLevel = "country" | "province" | "city" | "district" | "landmark";

export interface CurrentWindowLocationEvidence {
  nodeId: string;
  level: ExplicitLocationLevel;
  matchedAlias: string;
}

export interface CurrentWindowReportEvidence {
  original_text: string;
  normalized_text: string;
}

interface LocationNode {
  id: string;
  level: ExplicitLocationLevel;
  parentId: string | null;
  aliases: readonly string[];
}

// This is deliberately a small, auditable hierarchy rather than a general
// geocoder. Unknown places never produce a contradiction.
const LOCATION_NODES: readonly LocationNode[] = [
  { id: "iran", level: "country", parentId: null, aliases: ["ایران", "iran"] },
  { id: "tehran", level: "city", parentId: "iran", aliases: ["تهران", "طهران", "tehran"] },
  { id: "amol", level: "city", parentId: "iran", aliases: ["آمل", "آملی ها", "amol"] },
  { id: "mashhad", level: "city", parentId: "iran", aliases: ["مشهد", "mashhad"] },
  {
    id: "sadeghieh",
    level: "district",
    parentId: "tehran",
    aliases: ["فلکه دوم صادقیه", "صادقیه", "sadeghieh", "sadeghiyeh", "sadeghieh square", "second sadeghieh square"]
  }
];

const LOCATION_BY_ID = new Map(LOCATION_NODES.map((node) => [node.id, node]));
const LOCATION_ALIASES = LOCATION_NODES
  .flatMap((node) => node.aliases.map((alias) => ({ node, alias: normalizeLocationText(alias) })))
  .sort((left, right) => right.alias.length - left.alias.length);

export const HARD_CONTRADICTION_CODES = ["incompatible_explicit_locations"] as const;
export type HardContradictionCode = typeof HARD_CONTRADICTION_CODES[number];

export function normalizeLocationText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[يى]/gu, "ی")
    .replace(/[ك]/gu, "ک")
    .replace(/[ۀة]/gu, "ه")
    .replace(/\u0640/gu, "")
    .replace(/[\u064B-\u065F\u0670]/gu, "")
    .replace(/[\u200c\u200d]/gu, " ")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function extractExplicitLocations(text: string): CurrentWindowLocationEvidence[] {
  const normalized = normalizeLocationText(text);
  if (!normalized) return [];
  const padded = ` ${normalized} `;
  const matches: CurrentWindowLocationEvidence[] = [];
  const seen = new Set<string>();
  for (const { node, alias } of LOCATION_ALIASES) {
    if (!alias || !padded.includes(` ${alias} `) || seen.has(node.id)) continue;
    seen.add(node.id);
    matches.push({ nodeId: node.id, level: node.level, matchedAlias: alias });
  }
  return mostSpecificLocations(matches);
}

export function findCurrentWindowHardContradictions(
  left: CurrentWindowReportEvidence,
  right: CurrentWindowReportEvidence
): HardContradictionCode[] {
  const leftLocations = extractExplicitLocations(left.normalized_text || left.original_text);
  const rightLocations = extractExplicitLocations(right.normalized_text || right.original_text);

  // A missing or unknown location is not evidence of contradiction.
  if (leftLocations.length === 0 || rightLocations.length === 0) return [];
  if (leftLocations.some((leftLocation) => rightLocations.some((rightLocation) => locationsCanDescribeOneOccurrence(leftLocation.nodeId, rightLocation.nodeId)))) return [];
  return ["incompatible_explicit_locations"];
}

export function hasCurrentWindowHardContradiction(
  left: CurrentWindowReportEvidence,
  right: CurrentWindowReportEvidence
): boolean {
  return findCurrentWindowHardContradictions(left, right).length > 0;
}

function mostSpecificLocations(locations: readonly CurrentWindowLocationEvidence[]): CurrentWindowLocationEvidence[] {
  return locations.filter((location) => !locations.some((other) => other.nodeId !== location.nodeId && isAncestor(location.nodeId, other.nodeId)));
}

function locationsCanDescribeOneOccurrence(leftId: string, rightId: string): boolean {
  return isAncestor(leftId, rightId) || isAncestor(rightId, leftId);
}

function isAncestor(ancestorId: string, descendantId: string): boolean {
  let currentId: string | null = descendantId;
  while (currentId) {
    if (currentId === ancestorId) return true;
    currentId = LOCATION_BY_ID.get(currentId)?.parentId ?? null;
  }
  return false;
}
