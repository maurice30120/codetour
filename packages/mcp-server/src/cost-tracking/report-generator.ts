/**
 * Report Generator for Cost Baseline and Comparison
 * Part of spec #92, ticket #113
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { BaselineComparison, BenchmarkReport } from "./types";

/**
 * Generates JSON and Markdown reports for cost baseline and TokenEconomizer POC
 */
export class ReportGenerator {
  private version = "1.0.0";

  /**
   * Generate a benchmark report
   */
  async generateBenchmarkReport(
    comparisons: BaselineComparison[],
    environment: {
      os?: string;
      nodeVersion?: string;
      copilotVersion?: string;
      tokenEconomizerVersion?: string;
      repository: string;
      sha: string;
    },
    outputDir?: string
  ): Promise<BenchmarkReport> {
    const report: BenchmarkReport = {
      version: this.version,
      timestamp: new Date().toISOString(),
      environment: {
        os: environment.os || os.platform(),
        nodeVersion: environment.nodeVersion || process.version,
        copilotVersion: environment.copilotVersion,
        tokenEconomizerVersion: environment.tokenEconomizerVersion,
        repository: environment.repository,
        sha: environment.sha,
      },
      comparisons,
      summary: this.generateSummary(comparisons),
    };

    if (outputDir) {
      await this.writeReports(report, outputDir);
    }

    return report;
  }

  /**
   * Generate summary from comparisons
   */
  private generateSummary(comparisons: BaselineComparison[]): {
    totalCostSavings?: number;
    totalTokenSavings?: number;
    overallVerdict: string;
    recommendations: string[];
  } {
    let totalCostSavings = 0;
    let totalTokenSavings = 0;
    let hasPrometteur = false;
    let hasNonRentable = false;
    let hasIncompatible = false;

    for (const comparison of comparisons) {
      if (comparison.costSavings?.absolute) {
        totalCostSavings += comparison.costSavings.absolute;
      }
      if (comparison.tokenSavings?.totalTokens) {
        totalTokenSavings += comparison.tokenSavings.totalTokens;
      }

      if (comparison.verdict === "prometteur") {
        hasPrometteur = true;
      } else if (comparison.verdict === "non rentable") {
        hasNonRentable = true;
      } else if (comparison.verdict === "incompatible") {
        hasIncompatible = true;
      }
    }

    // Determine overall verdict
    let overallVerdict = "indéterminé";
    if (hasIncompatible) {
      overallVerdict = "incompatible";
    } else if (hasNonRentable && !hasPrometteur) {
      overallVerdict = "non rentable";
    } else if (hasPrometteur) {
      overallVerdict = "prometteur";
    }

    // Generate recommendations
    const recommendations: string[] = [];
    
    if (hasPrometteur) {
      recommendations.push(
        "TokenEconomizer montre des économies de coût significatives. Considérer l'intégration pour les environnement de production."
      );
    }

    if (hasNonRentable) {
      recommendations.push(
        "TokenEconomizer n'est pas rentable pour certains scénarios. Analyser les différences de contexte."
      );
    }

    if (hasIncompatible) {
      recommendations.push(
        "TokenEconomizer n'est pas compatible avec la version actuelle de Copilot. Mettre à jour Copilot ou attendre la compatibilité."
      );
    }

    if (comparisons.length === 0) {
      recommendations.push(
        "Aucune comparaison effectuée. Exécuter les tests de baseline d'abord."
      );
    }

    return {
      totalCostSavings: totalCostSavings > 0 ? totalCostSavings : undefined,
      totalTokenSavings: totalTokenSavings > 0 ? totalTokenSavings : undefined,
      overallVerdict,
      recommendations,
    };
  }

  /**
   * Write JSON and Markdown reports to disk
   */
  private async writeReports(
    report: BenchmarkReport,
    outputDir: string
  ): Promise<void> {
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    // Write JSON report
    const jsonPath = path.join(outputDir, `cost-baseline-report-${report.timestamp}.json`);
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf-8");

    // Write Markdown report
    const mdPath = path.join(outputDir, `cost-baseline-report-${report.timestamp}.md`);
    const markdown = this.generateMarkdownReport(report);
    await fs.writeFile(mdPath, markdown, "utf-8");
  }

  /**
   * Generate Markdown report
   */
  generateMarkdownReport(report: BenchmarkReport): string {
    const lines: string[] = [];

    lines.push(`# Rapport de Baseline de Coût CodeTour`);
    lines.push(`**Version :** ${report.version}`);
    lines.push(`**Date :** ${new Date(report.timestamp).toLocaleString()}`);
    lines.push("");

    // Environment
    lines.push("## Environnement");
    lines.push("");
    lines.push(`| Propriété | Valeur |`);
    lines.push(`|-----------|--------|`);
    lines.push(`| OS | ${report.environment.os} |`);
    lines.push(`| Version Node.js | ${report.environment.nodeVersion} |`);
    lines.push(`| Version Copilot | ${report.environment.copilotVersion || "N/D"} |`);
    lines.push(`| Version TokenEconomizer | ${report.environment.tokenEconomizerVersion || "N/D"} |`);
    lines.push(`| Dépôt | ${report.environment.repository} |`);
    lines.push(`| SHA | ${report.environment.sha} |`);
    lines.push("");

    // Summary
    lines.push("## Résumé");
    lines.push("");
    lines.push(
      `**Verdict global :** ${this.formatVerdict(report.summary.overallVerdict)}`
    );
    if (report.summary.totalCostSavings !== undefined) {
      lines.push(
        `**Économies totales estimées :** $${report.summary.totalCostSavings.toFixed(4)}`
      );
    }
    if (report.summary.totalTokenSavings !== undefined) {
      lines.push(
        `**Tokens économisés :** ${report.summary.totalTokenSavings.toLocaleString()}`
      );
    }
    lines.push("");
    lines.push("### Recommandations");
    lines.push("");
    for (const rec of report.summary.recommendations) {
      lines.push(`- ${rec}`);
    }
    lines.push("");

    // Comparisons
    lines.push("## Comparaisons des Scénarios");
    lines.push("");

    for (const comparison of report.comparisons) {
      lines.push(`### ${comparison.scenario}`);
      lines.push("");
      lines.push(`| Métrique | Baseline A | Avec TokenEconomizer B |`);
      lines.push(`|----------|-------------|------------------------|`);

      // Tokens
      lines.push(
        `| Input Tokens | ${comparison.baseline.metrics.tokenUsage.inputTokens.toLocaleString()} | ${comparison.withTokenEconomizer?.metrics.tokenUsage.inputTokens.toLocaleString() || "N/A"} |`
      );
      lines.push(
        `| Output Tokens | ${comparison.baseline.metrics.tokenUsage.outputTokens.toLocaleString()} | ${comparison.withTokenEconomizer?.metrics.tokenUsage.outputTokens.toLocaleString() || "N/A"} |`
      );
      lines.push(
        `| Cache Tokens | ${comparison.baseline.metrics.tokenUsage.cacheTokens.toLocaleString()} | ${comparison.withTokenEconomizer?.metrics.tokenUsage.cacheTokens.toLocaleString() || "N/A"} |`
      );
      lines.push(
        `| Total Tokens | ${comparison.baseline.metrics.tokenUsage.totalTokens.toLocaleString()} | ${comparison.withTokenEconomizer?.metrics.tokenUsage.totalTokens.toLocaleString() || "N/A"} |`
      );

      // Cost
      lines.push(
        `| Coût estimé | $${comparison.baseline.metrics.cost.estimatedCost?.toFixed(4) || "0.0000"} | ${comparison.withTokenEconomizer?.metrics.cost.estimatedCost !== undefined ? `$${comparison.withTokenEconomizer.metrics.cost.estimatedCost.toFixed(4)}` : "N/A"} |`
      );

      // Duration
      lines.push(
        `| Durée (ms) | ${comparison.baseline.metrics.durationMs} | ${comparison.withTokenEconomizer?.metrics.durationMs || "N/A"} |`
      );

      // Steps
      lines.push(
        `| Étapes | ${comparison.baseline.metrics.stepsGenerated} | ${comparison.withTokenEconomizer?.metrics.stepsGenerated || "N/A"} |`
      );

      lines.push("");

      // Savings
      if (comparison.costSavings) {
        lines.push(`**Économies :**`);
        lines.push(`- Absolute : $${comparison.costSavings.absolute.toFixed(4)}`);
        lines.push(`- Pourcentage : ${comparison.costSavings.percentage.toFixed(2)}%`);
        lines.push("");
      }

      if (comparison.tokenSavings) {
        lines.push(`**Tokens économisés :**`);
        lines.push(
          `- Input : ${comparison.tokenSavings.inputTokens.toLocaleString()}`
        );
        lines.push(
          `- Output : ${comparison.tokenSavings.outputTokens.toLocaleString()}`
        );
        lines.push(
          `- Cache : ${comparison.tokenSavings.cacheTokens.toLocaleString()}`
        );
        lines.push(
          `- Total : ${comparison.tokenSavings.totalTokens.toLocaleString()}`
        );
        lines.push("");
      }

      lines.push(`**Verdict :** ${this.formatVerdict(comparison.verdict)}`);
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    lines.push("## Méthodologie");
    lines.push("");
    lines.push(
      "Ce rapport a été généré dans le cadre du POC TokenEconomizer pour CodeTour (spec #92, ticket #113)."
    );
    lines.push(
      "Les métriques ont été collectées sur des exécutions réelles de génération de Tours avec GitHub Copilot CLI."
    );
    lines.push("");
    lines.push(
      "### Scénario A (Baseline) : Copilot historique sans optimisation"
    );
    lines.push(
      "### Scénario B : Copilot + TokenEconomizer (plugin Microsoft Research)"
    );
    lines.push("");
    lines.push("Toutes les économies sont basées sur des estimations de coût.");

    return lines.join("\n");
  }

  /**
   * Format verdict for display
   */
  private formatVerdict(verdict: string): string {
    const labels: Record<string, string> = {
      prometteur: "🟢 Prometteur",
      "non rentable": "🔴 Non rentable",
      incompatible: "⚠️ Incompatible",
      "données insuffisantes": "⚪ Données insuffisantes",
      indéterminé: "❓ Indéterminé",
    };
    return labels[verdict] || verdict;
  }

  /**
   * Generate a simple text summary
   */
  generateTextSummary(report: BenchmarkReport): string {
    const lines: string[] = [];

    lines.push("=" .repeat(60));
    lines.push("Rapport de Baseline de Coût CodeTour");
    lines.push(`Version: ${report.version}`);
    lines.push(`Date: ${new Date(report.timestamp).toLocaleString()}`);
    lines.push("=" .repeat(60));
    lines.push("");

    lines.push("ENVIRONNEMENT");
    lines.push("-" .repeat(60));
    lines.push(`OS: ${report.environment.os}`);
    lines.push(`Node.js: ${report.environment.nodeVersion}`);
    lines.push(`Copilot: ${report.environment.copilotVersion || "N/D"}`);
    lines.push(`TokenEconomizer: ${report.environment.tokenEconomizerVersion || "N/D"}`);
    lines.push(`Repository: ${report.environment.repository}`);
    lines.push(`SHA: ${report.environment.sha}`);
    lines.push("");

    lines.push("RÉSUMÉ");
    lines.push("-" .repeat(60));
    lines.push(`Verdict: ${this.formatVerdict(report.summary.overallVerdict)}`);
    if (report.summary.totalCostSavings !== undefined) {
      lines.push(`Économies: $${report.summary.totalCostSavings.toFixed(4)}`);
    }
    if (report.summary.totalTokenSavings !== undefined) {
      lines.push(`Tokens: ${report.summary.totalTokenSavings.toLocaleString()}`);
    }
    lines.push("");

    lines.push("RECOMMANDATIONS");
    lines.push("-" .repeat(60));
    for (const rec of report.summary.recommendations) {
      lines.push(`• ${rec}`);
    }
    lines.push("");

    lines.push("COMPARAISONS");
    lines.push("-" .repeat(60));
    for (const comparison of report.comparisons) {
      lines.push(`Scenario: ${comparison.scenario}`);
      lines.push(`  Verdict: ${this.formatVerdict(comparison.verdict)}`);
      if (comparison.costSavings) {
        lines.push(
          `  Savings: $${comparison.costSavings.absolute.toFixed(4)} (${comparison.costSavings.percentage.toFixed(2)}%)`
        );
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}
