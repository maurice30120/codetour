/**
 * Tour Type Detector Unit Tests
 *
 * Tests for the automatic tour type detection module.
 *
 * Part of Spec: Hybrid Targeted Context
 * Ticket #01: Détection automatique du type de Tour
 */

import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectTourType,
  getApproachForTourType,
  getTourConfiguration,
  validateDetectionLogic,
  TourType,
  TourTypeDetectionResult,
} from "../../src/targeted-context/tour-type-detector";

describe("Tour Type Detection", () => {
  describe("detectTourType", () => {
    describe("Changes Tour Detection (baseRef AND headRef present)", () => {
      it("should detect Changes Tour with both refs", () => {
        const result = detectTourType({
          baseRef: "abc123",
          headRef: "def456",
        });

        assert.equal(result.tourType, "changes-tour");
        assert.equal(result.isCertain, true);
      });

      it("should include both refs in reason", () => {
        const result = detectTourType({
          baseRef: "abc123",
          headRef: "def456",
        });

        assert.ok(result.reason.includes("baseRef and headRef are present"));
      });

      it("should store all parameters", () => {
        const params = {
          baseRef: "abc123",
          headRef: "def456",
          workspacePath: "/path/to/workspace",
          fileName: "test.tour",
        };

        const result = detectTourType(params);

        assert.deepEqual(result.params, params);
      });

      it("should work with full-length commit SHAs", () => {
        const result = detectTourType({
          baseRef: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
          headRef: "f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0",
        });

        assert.equal(result.tourType, "changes-tour");
      });

      it("should work with whitespace in refs", () => {
        const result = detectTourType({
          baseRef: "  abc123  ",
          headRef: "  def456  ",
        });

        assert.equal(result.tourType, "changes-tour");
      });
    });

    describe("Project Tour Detection (missing baseRef OR headRef)", () => {
      it("should detect Project Tour with no parameters", () => {
        const result = detectTourType({});

        assert.equal(result.tourType, "project-tour");
        assert.equal(result.isCertain, true);
      });

      it("should detect Project Tour with only baseRef", () => {
        const result = detectTourType({
          baseRef: "abc123",
        });

        assert.equal(result.tourType, "project-tour");
      });

      it("should detect Project Tour with only headRef", () => {
        const result = detectTourType({
          headRef: "def456",
        });

        assert.equal(result.tourType, "project-tour");
      });

      it("should detect Project Tour with only workspacePath", () => {
        const result = detectTourType({
          workspacePath: "/path/to/workspace",
        });

        assert.equal(result.tourType, "project-tour");
      });

      it("should detect Project Tour with only fileName", () => {
        const result = detectTourType({
          fileName: "test.tour",
        });

        assert.equal(result.tourType, "project-tour");
      });

      it("should detect Project Tour with empty string refs", () => {
        const result = detectTourType({
          baseRef: "",
          headRef: "",
        });

        assert.equal(result.tourType, "project-tour");
      });

      it("should detect Project Tour with whitespace-only refs", () => {
        const result = detectTourType({
          baseRef: "   ",
          headRef: "   ",
        });

        assert.equal(result.tourType, "project-tour");
      });

      it("should include reason about missing refs", () => {
        const result = detectTourType({});

        assert.ok(result.reason.includes("Missing baseRef and/or headRef"));
      });
    });

    describe("Edge Cases", () => {
      it("should handle undefined parameters", () => {
        const result = detectTourType({
          baseRef: undefined,
          headRef: undefined,
        });

        assert.equal(result.tourType, "project-tour");
      });

      it("should handle null parameters", () => {
        const result = detectTourType({
          baseRef: null as unknown as string,
          headRef: null as unknown as string,
        });

        // null values are falsy, so should detect as Project Tour
        assert.equal(result.tourType, "project-tour");
      });

      it("should handle very long strings", () => {
        const result = detectTourType({
          baseRef: "a".repeat(1000),
          headRef: "b".repeat(1000),
        });

        assert.equal(result.tourType, "changes-tour");
      });

      it("should handle special characters in refs", () => {
        const result = detectTourType({
          baseRef: "abc-123_def",
          headRef: "def+456=ghi",
        });

        assert.equal(result.tourType, "changes-tour");
      });
    });
  });

  describe("getApproachForTourType", () => {
    it("should return C for changes-tour", () => {
      const approach = getApproachForTourType("changes-tour");
      assert.equal(approach, "C");
    });

    it("should return D for project-tour", () => {
      const approach = getApproachForTourType("project-tour");
      assert.equal(approach, "D");
    });

    it("should return D for unknown tour type as default", () => {
      const approach = getApproachForTourType("unknown" as TourType);
      assert.equal(approach, "D");
    });
  });

  describe("getTourConfiguration", () => {
    it("should return correct configuration for Changes Tour", () => {
      const config = getTourConfiguration({
        baseRef: "abc123",
        headRef: "def456",
      });

      assert.equal(config.detection.tourType, "changes-tour");
      assert.equal(config.approach, "C");
      assert.equal(config.tourType, "changes-tour");
    });

    it("should return correct configuration for Project Tour", () => {
      const config = getTourConfiguration({});

      assert.equal(config.detection.tourType, "project-tour");
      assert.equal(config.approach, "D");
      assert.equal(config.tourType, "project-tour");
    });

    it("should include detection result", () => {
      const params = {
        baseRef: "abc123",
        headRef: "def456",
        workspacePath: "/path",
      };

      const config = getTourConfiguration(params);

      assert.notEqual(config.detection, undefined);
      assert.equal(config.detection.tourType, "changes-tour");
      assert.equal(config.detection.params.baseRef, params.baseRef);
      assert.equal(config.detection.params.headRef, params.headRef);
      assert.equal(config.detection.params.workspacePath, params.workspacePath);
    });
  });

  describe("validateDetectionLogic", () => {
    it("should return true for all test cases", () => {
      assert.equal(validateDetectionLogic(), true);
    });
  });
});

describe("Type Safety", () => {
  it("should have correct TourType type", () => {
    const changesTour: TourType = "changes-tour";
    const projectTour: TourType = "project-tour";

    assert.equal(changesTour, "changes-tour");
    assert.equal(projectTour, "project-tour");
  });

  it("should have correct detection result structure", () => {
    const result = detectTourType({ baseRef: "abc", headRef: "def" });

    const expectedKeys: (keyof TourTypeDetectionResult)[] = [
      "tourType",
      "isCertain",
      "reason",
      "params",
    ];

    for (const key of expectedKeys) {
      assert.ok(key in result, `missing property ${key}`);
    }
  });
});
