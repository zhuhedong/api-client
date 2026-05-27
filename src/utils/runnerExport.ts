/**
 * Export Collection Runner results in multiple formats:
 * - JUnit XML (for CI integration with Jenkins, GitHub Actions, etc.)
 * - JSON (machine-readable)
 * - HTML (human-readable standalone report)
 */

import type { TestResult } from "../types";

export interface RunResult {
  name: string;
  method: string;
  status?: number;
  timeMs?: number;
  tests: TestResult[];
  error?: string;
  iteration: number;
}

export interface RunSummary {
  collectionName: string;
  totalRequests: number;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  erroredRequests: number;
  totalTimeMs: number;
  iterations: number;
  timestamp: string;
}

function summarize(
  results: RunResult[],
  collectionName: string,
  iterations: number,
): RunSummary {
  const totalTests = results.reduce((s, r) => s + r.tests.length, 0);
  const passedTests = results.reduce(
    (s, r) => s + r.tests.filter((t) => t.passed).length,
    0,
  );
  return {
    collectionName,
    totalRequests: results.length,
    totalTests,
    passedTests,
    failedTests: totalTests - passedTests,
    erroredRequests: results.filter((r) => r.error).length,
    totalTimeMs: results.reduce((s, r) => s + (r.timeMs ?? 0), 0),
    iterations,
    timestamp: new Date().toISOString(),
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---- JUnit XML ---------------------------------------------------------------

export function exportJUnit(
  results: RunResult[],
  collectionName: string,
  iterations: number,
): string {
  const summary = summarize(results, collectionName, iterations);
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${escapeXml(collectionName)}" tests="${summary.totalTests}" failures="${summary.failedTests}" errors="${summary.erroredRequests}" time="${(summary.totalTimeMs / 1000).toFixed(3)}">`,
  ];

  // Group results by iteration
  const byIteration = new Map<number, RunResult[]>();
  for (const r of results) {
    const arr = byIteration.get(r.iteration) ?? [];
    arr.push(r);
    byIteration.set(r.iteration, arr);
  }

  for (const [iter, iterResults] of byIteration) {
    const iterTests = iterResults.reduce((s, r) => s + r.tests.length, 0);
    const iterFailed = iterResults.reduce(
      (s, r) => s + r.tests.filter((t) => !t.passed).length,
      0,
    );
    const iterErrors = iterResults.filter((r) => r.error).length;
    const iterTime = iterResults.reduce((s, r) => s + (r.timeMs ?? 0), 0);

    lines.push(
      `  <testsuite name="${escapeXml(collectionName)} - Iteration ${iter}" tests="${iterTests}" failures="${iterFailed}" errors="${iterErrors}" time="${(iterTime / 1000).toFixed(3)}">`,
    );

    for (const r of iterResults) {
      if (r.tests.length === 0) {
        // Emit a single test case for the request itself
        const time = ((r.timeMs ?? 0) / 1000).toFixed(3);
        if (r.error) {
          lines.push(
            `    <testcase name="${escapeXml(r.name)}" classname="${escapeXml(r.method)} ${escapeXml(r.name)}" time="${time}">`,
          );
          lines.push(
            `      <error message="${escapeXml(r.error)}" />`,
          );
          lines.push("    </testcase>");
        } else {
          lines.push(
            `    <testcase name="${escapeXml(r.name)}" classname="${escapeXml(r.method)} ${escapeXml(r.name)}" time="${time}" />`,
          );
        }
      } else {
        const perTestTime = (
          (r.timeMs ?? 0) /
          r.tests.length /
          1000
        ).toFixed(3);
        for (const t of r.tests) {
          if (t.passed) {
            lines.push(
              `    <testcase name="${escapeXml(t.name)}" classname="${escapeXml(r.method)} ${escapeXml(r.name)}" time="${perTestTime}" />`,
            );
          } else {
            lines.push(
              `    <testcase name="${escapeXml(t.name)}" classname="${escapeXml(r.method)} ${escapeXml(r.name)}" time="${perTestTime}">`,
            );
            lines.push(
              `      <failure message="${escapeXml(t.error ?? "assertion failed")}" />`,
            );
            lines.push("    </testcase>");
          }
        }
      }
    }
    lines.push("  </testsuite>");
  }
  lines.push("</testsuites>");
  return lines.join("\n");
}

// ---- JSON --------------------------------------------------------------------

export function exportJson(
  results: RunResult[],
  collectionName: string,
  iterations: number,
): string {
  const summary = summarize(results, collectionName, iterations);
  return JSON.stringify({ summary, results }, null, 2);
}

// ---- HTML report -------------------------------------------------------------

export function exportHtml(
  results: RunResult[],
  collectionName: string,
  iterations: number,
): string {
  const summary = summarize(results, collectionName, iterations);
  const passRate =
    summary.totalTests > 0
      ? ((summary.passedTests / summary.totalTests) * 100).toFixed(1)
      : "N/A";

  const rows = results
    .map((r) => {
      const statusBadge = r.error
        ? '<span style="color:#ef4444">ERROR</span>'
        : r.tests.length > 0 && r.tests.every((t) => t.passed)
          ? '<span style="color:#22c55e">PASS</span>'
          : r.tests.some((t) => !t.passed)
            ? '<span style="color:#ef4444">FAIL</span>'
            : '<span style="color:#6b7280">OK</span>';

      const testDetails = r.tests
        .map(
          (t) =>
            `<div style="padding-left:16px;font-size:12px;color:${t.passed ? "#22c55e" : "#ef4444"}">${t.passed ? "✓" : "✗"} ${escapeHtml(t.name)}${t.error ? ` — ${escapeHtml(t.error)}` : ""}</div>`,
        )
        .join("");

      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:11px;color:#6b7280">${escapeHtml(r.method)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(r.name)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${r.status ?? "—"}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;font-size:12px">${r.timeMs !== undefined ? `${r.timeMs}ms` : "—"}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${statusBadge}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${iterations > 1 ? `#${r.iteration}` : ""}</td>
      </tr>
      ${testDetails ? `<tr><td colspan="6" style="padding:2px 10px 8px 40px;border-bottom:1px solid #f3f4f6">${testDetails}</td></tr>` : ""}`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Collection Run: ${escapeHtml(collectionName)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:960px;margin:24px auto;padding:0 16px;color:#1f2937}
h1{font-size:20px;font-weight:600}
.meta{font-size:13px;color:#6b7280;margin-bottom:16px}
.stats{display:flex;gap:24px;margin-bottom:16px;flex-wrap:wrap}
.stat{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px}
.stat-label{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em}
.stat-value{font-size:20px;font-weight:600;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:8px 10px;border-bottom:2px solid #e5e7eb;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280}
</style>
</head>
<body>
<h1>Collection Run: ${escapeHtml(collectionName)}</h1>
<div class="meta">${escapeHtml(summary.timestamp)} &middot; ${summary.iterations} iteration${summary.iterations !== 1 ? "s" : ""} &middot; ${summary.totalRequests} request${summary.totalRequests !== 1 ? "s" : ""}</div>
<div class="stats">
<div class="stat"><div class="stat-label">Total Tests</div><div class="stat-value">${summary.totalTests}</div></div>
<div class="stat"><div class="stat-label">Passed</div><div class="stat-value" style="color:#22c55e">${summary.passedTests}</div></div>
<div class="stat"><div class="stat-label">Failed</div><div class="stat-value" style="color:#ef4444">${summary.failedTests}</div></div>
<div class="stat"><div class="stat-label">Pass Rate</div><div class="stat-value">${passRate}%</div></div>
<div class="stat"><div class="stat-label">Total Time</div><div class="stat-value">${summary.totalTimeMs}ms</div></div>
</div>
<table>
<thead><tr><th>Method</th><th>Name</th><th>Status</th><th style="text-align:right">Time</th><th>Result</th><th>Iter</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>`;
}
