import type { SurfaceClient, SurfaceToolResult } from "../surface/types.js";
import type { AccessibilityLocator, CapabilityValue } from "./types.js";

export class AccessibilityResolutionError extends Error {}

export function textFromSurfaceResult(result: SurfaceToolResult): string {
  return (result.content ?? [])
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const block = item as Record<string, unknown>;
      return block.type === "text" && typeof block.text === "string" ? [block.text] : [];
    })
    .join("\n");
}

function decodedQuotedValue(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

function nodeOnLine(line: string, role: string): { name: string; target: string } | null {
  const escapedRole = role.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = line.match(
    new RegExp(`\\b${escapedRole}(?:\\s+"((?:\\\\.|[^"\\\\])*)")?[^\\n]*\\[ref=([^\\]]+)\\]`)
  );
  if (!match || match[2] === undefined) return null;
  return { name: match[1] === undefined ? "" : decodedQuotedValue(match[1]), target: match[2] };
}

export async function resolveAccessibilityLocator(
  surface: SurfaceClient,
  locator: AccessibilityLocator,
  inputs: Record<string, CapabilityValue> = {}
): Promise<string> {
  const withinRowValue = locator.withinRowInput
    ? inputs[locator.withinRowInput]
    : undefined;
  if (locator.withinRowInput && withinRowValue === undefined) {
    throw new AccessibilityResolutionError(
      `Accessibility locator has no value for ${locator.withinRowInput}.`
    );
  }
  const query = withinRowValue === undefined
    ? locator.name ?? locator.nearText
    : String(withinRowValue);
  if (!query) throw new AccessibilityResolutionError("Accessibility locator has no search anchor.");
  const result = await surface.callTool("browser_find", { text: query });
  if (result.isError) throw new AccessibilityResolutionError(`Could not search for ${query}.`);
  const lines = textFromSurfaceResult(result).split("\n");
  const candidates: Array<{ name: string; target: string }> = [];

  if (withinRowValue !== undefined && locator.name) {
    for (let index = 0; index < lines.length; index += 1) {
      const anchor = nodeOnLine(lines[index] ?? "", "cell");
      if (!anchor || anchor.name !== String(withinRowValue)) continue;
      const anchorIndent = (lines[index] ?? "").search(/\S/);
      for (let offset = 1; offset <= 16; offset += 1) {
        const line = lines[index + offset];
        if (!line) break;
        const indent = line.search(/\S/);
        if (offset > 1 && /^\s*- row\b/.test(line) && indent < anchorIndent) break;
        const node = nodeOnLine(line, locator.role);
        if (!node) continue;
        const matches = locator.exact
          ? node.name === locator.name
          : node.name.toLocaleLowerCase().includes(locator.name.toLocaleLowerCase());
        if (matches) candidates.push(node);
      }
    }
  } else if (locator.name) {
    for (const line of lines) {
      const node = nodeOnLine(line, locator.role);
      if (!node) continue;
      const matches = locator.exact
        ? node.name === locator.name
        : node.name.toLocaleLowerCase().includes(locator.name.toLocaleLowerCase());
      if (matches) candidates.push(node);
    }
  } else if (locator.nearText) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (!/\btext:\s*/.test(line) || !line.includes(locator.nearText)) continue;
      for (let offset = 1; offset <= 5; offset += 1) {
        const candidateLine = lines[index + offset];
        if (!candidateLine || candidateLine.trim() === "----") break;
        const node = nodeOnLine(candidateLine, locator.role);
        if (node) {
          candidates.push(node);
          break;
        }
      }
    }
  }

  const uniqueTargets = [...new Set(candidates.map((candidate) => candidate.target))];
  if (uniqueTargets.length !== 1) {
    throw new AccessibilityResolutionError(
      `Expected one ${locator.role} for ${query}, found ${uniqueTargets.length}.`
    );
  }
  return uniqueTargets[0] as string;
}

export function extractAccessibilityTableRow(snapshot: string, label: string): string {
  const lines = snapshot.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const header = nodeOnLine(lines[index] ?? "", "rowheader");
    if (!header || header.name !== label) continue;
    for (let offset = 1; offset <= 4; offset += 1) {
      const line = lines[index + offset];
      if (!line) break;
      const cell = nodeOnLine(line, "cell");
      if (cell) return cell.name;
      if (nodeOnLine(line, "rowheader")) break;
    }
  }
  throw new AccessibilityResolutionError(`Could not extract table row ${label}.`);
}
