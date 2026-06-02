import { Request, Response } from "express";
import { AnalysisValidator } from "../validation/analysis.validator";

describe("AnalysisValidator", () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockRequest = {
      body: {},
      headers: { "x-request-id": "test-request-id" },
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
  });

  describe("validateSubmission", () => {
    it("should pass validation for valid request", () => {
      mockRequest.body = {
        project: {
          name: "Test Project",
          description: "A test project",
          repositoryUrl: "https://github.com/user/repo",
        },
        files: [
          {
            path: "src/main.rs",
            content: "fn main() {}",
            language: "rust",
            size: 100,
          },
        ],
        options: {
          scanType: "security",
          severity: "high",
        },
      };

      AnalysisValidator.validateSubmission(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it("should reject request with missing project", () => {
      mockRequest.body = {
        files: [
          {
            path: "src/main.rs",
            content: "fn main() {}",
            language: "rust",
            size: 100,
          },
        ],
      };

      AnalysisValidator.validateSubmission(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: "VALIDATION_ERROR",
            message: "Request validation failed",
          }),
          validationErrors: expect.arrayContaining([
            expect.objectContaining({
              field: "project",
              message: "Project information is required",
            }),
          ]),
        }),
      );
    });

    it("should reject request with invalid repository URL", () => {
      mockRequest.body = {
        project: {
          name: "Test Project",
          repositoryUrl: "not-a-valid-url",
        },
        files: [
          {
            path: "src/main.rs",
            content: "fn main() {}",
            language: "rust",
            size: 100,
          },
        ],
      };

      AnalysisValidator.validateSubmission(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          validationErrors: expect.arrayContaining([
            expect.objectContaining({
              field: "project.repositoryUrl",
              message: "Invalid repository URL format",
            }),
          ]),
        }),
      );
    });

    it("should reject request with no files", () => {
      mockRequest.body = {
        project: {
          name: "Test Project",
        },
        files: [],
      };

      AnalysisValidator.validateSubmission(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          validationErrors: expect.arrayContaining([
            expect.objectContaining({
              field: "files",
              message: "At least one file must be submitted",
            }),
          ]),
        }),
      );
    });

    it("should reject request with invalid file language", () => {
      mockRequest.body = {
        project: {
          name: "Test Project",
        },
        files: [
          {
            path: "src/main.py",
            content: 'print("hello")',
            language: "python", // not supported
            size: 100,
          },
        ],
      };

      AnalysisValidator.validateSubmission(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          validationErrors: expect.arrayContaining([
            expect.objectContaining({
              field: "files[0].language",
              message:
                "Language must be one of: rust, typescript, javascript, solidity, soroban",
            }),
          ]),
        }),
      );
    });

    it("should reject request with file too large", () => {
      mockRequest.body = {
        project: {
          name: "Test Project",
        },
        files: [
          {
            path: "src/main.rs",
            content: "fn main() {}",
            language: "rust",
            size: 20000000, // 20MB, over limit
          },
        ],
      };

      AnalysisValidator.validateSubmission(
        mockRequest as Request,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          validationErrors: expect.arrayContaining([
            expect.objectContaining({
              field: "files[0].size",
              message: "File size exceeds maximum of 10485760 bytes",
            }),
          ]),
        }),
      );
    });
  });
});
