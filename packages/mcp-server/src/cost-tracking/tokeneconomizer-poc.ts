/**
 * TokenEconomizer POC Integration
 * Part of spec #92, ticket #113
 */

import { exec, ChildProcess } from "node:child_process";
import {
  TokenEconomizerConfig,
  TokenEconomizerSettings,
} from "./types";

/**
 * TokenEconomizer POC manager
 * Handles installation, configuration, and compatibility checking
 */
export class TokenEconomizerPOC {
  private config: TokenEconomizerConfig;
  private process?: ChildProcess;

  constructor(config: Partial<TokenEconomizerConfig> = {}) {
    this.config = {
      enabled: false,
      settings: {},
      compatible: false,
      ...config,
    };
  }

  /**
   * Check if TokenEconomizer is compatible with current Copilot version
   */
  async checkCompatibility(copilotVersion: string): Promise<boolean> {
    // TokenEconomizer documents compatibility with Copilot CLI 1.0.83-1.0.102
    const compatibleRange = this.parseVersionRange("1.0.83", "1.0.102");
    const currentVersion = this.parseVersion(copilotVersion);

    if (!currentVersion) {
      this.config.compatible = false;
      this.config.error = `Invalid Copilot version: ${copilotVersion}`;
      return false;
    }

    const isCompatible =
      this.compareVersions(currentVersion, compatibleRange.min) >= 0 &&
      this.compareVersions(currentVersion, compatibleRange.max) <= 0;

    this.config.compatible = isCompatible;
    this.config.copilotVersion = copilotVersion;

    if (!isCompatible) {
      this.config.error = `Copilot version ${copilotVersion} is not in compatible range 1.0.83-1.0.102`;
    }

    return isCompatible;
  }

  /**
   * Parse version string into comparable parts
   */
  private parseVersion(version: string): number[] | null {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return [
      parseInt(match[1], 10),
      parseInt(match[2], 10),
      parseInt(match[3], 10),
    ];
  }

  /**
   * Parse version range
   */
  private parseVersionRange(min: string, max: string): {
    min: number[];
    max: number[];
  } {
    return {
      min: this.parseVersion(min) || [0, 0, 0],
      max: this.parseVersion(max) || [999, 999, 999],
    };
  }

  /**
   * Compare two version arrays
   * Returns -1 if a < b, 0 if a === b, 1 if a > b
   */
  private compareVersions(a: number[], b: number[]): number {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return a.length - b.length;
  }

  /**
   * Get Copilot version
   */
  async getCopilotVersion(): Promise<string> {
    try {
      const result = await new Promise<{ stdout: string; stderr: string }>(
        (resolve, reject) => {
          exec("copilot --version", (error, stdout, stderr) => {
            if (error) {
              reject(error);
            } else {
              resolve({ stdout, stderr });
            }
          });
        }
      );
      
      // Parse version from output like "GitHub Copilot CLI v1.0.105"
      const match = result.stdout.match(/v(\d+\.\d+\.\d+)/);
      if (match) {
        return match[1];
      }
      return "unknown";
    } catch (error) {
      this.config.error = `Failed to get Copilot version: ${error}`;
      return "unknown";
    }
  }

  /**
   * Check if Python is available and meets minimum version requirement
   */
  async checkPython(): Promise<boolean> {
    try {
      const result = await new Promise<{ stdout: string; stderr: string }>(
        (resolve, reject) => {
          exec("python3 --version || python --version", (error, stdout, stderr) => {
            if (error) {
              reject(error);
            } else {
              resolve({ stdout, stderr });
            }
          });
        }
      );

      // Parse version like "Python 3.10.12"
      const match = result.stdout.match(/Python (\d+\.\d+)/);
      if (match) {
        const version = parseFloat(match[1]);
        if (version >= 3.10) {
          this.config.pythonPath = "python3";
          return true;
        }
      }
      
      this.config.error = `Python >= 3.10 required`;
      return false;
    } catch (error) {
      this.config.error = `Python not found: ${error}`;
      return false;
    }
  }

  /**
   * Initialize TokenEconomizer POC
   */
  async initialize(settings?: TokenEconomizerSettings): Promise<TokenEconomizerConfig> {
    this.config.settings = { ...this.config.settings, ...settings };

    // Check Python
    const pythonOk = await this.checkPython();
    if (!pythonOk) {
      this.config.compatible = false;
      this.config.enabled = false;
      return this.config;
    }

    // Check Copilot version
    const copilotVersion = await this.getCopilotVersion();
    const compatible = await this.checkCompatibility(copilotVersion);

    this.config.compatible = compatible;
    this.config.copilotVersion = copilotVersion;

    // Default settings for POC
    if (!this.config.settings.toolPrune) {
      this.config.settings.toolPrune = "off";
    }

    return this.config;
  }

  /**
   * Start TokenEconomizer with Copilot
   * Note: This is a POC and may not work with all Copilot versions
   */
  start(workspace?: string): Promise<void> {
    return Promise.resolve(); // POC placeholder
  }

  /**
   * Stop TokenEconomizer
   */
  stop(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }
    return Promise.resolve();
  }

  /**
   * Get current configuration
   */
  getConfig(): TokenEconomizerConfig {
    return { ...this.config };
  }

  /**
   * Enable TokenEconomizer
   */
  enable(): void {
    this.config.enabled = true;
  }

  /**
   * Disable TokenEconomizer
   */
  disable(): void {
    this.config.enabled = false;
  }

  /**
   * Check if TokenEconomizer is enabled and compatible
   */
  isAvailable(): boolean {
    return this.config.enabled && this.config.compatible;
  }

  /**
   * Clean up resources
   */
  cleanup(): Promise<void> {
    return this.stop();
  }
}
