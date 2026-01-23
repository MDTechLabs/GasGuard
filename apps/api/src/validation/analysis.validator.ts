import { Request, Response, NextFunction } from 'express';
import { CodebaseSubmissionRequest, ValidationError } from '../schemas/analysis.schema';

export class AnalysisValidator {
  private static readonly SUPPORTED_LANGUAGES = ['rust', 'typescript', 'javascript', 'solidity'];
  private static readonly SUPPORTED_FRAMEWORKS = ['soroban', 'solidity', 'general'];
  private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  private static readonly MAX_FILES = 100;
  private static readonly MAX_CONTENT_LENGTH = 50 * 1024 * 1024; // 50MB

  static validateSubmission(req: Request, res: Response, next: NextFunction): void {
    const body = req.body as CodebaseSubmissionRequest;
    const errors: ValidationError[] = [];

    try {
      // Validate project information
      if (!body.project) {
        errors.push({
          field: 'project',
          message: 'Project information is required',
          constraint: 'required'
        });
      } else {
        if (!body.project.name || body.project.name.trim().length === 0) {
          errors.push({
            field: 'project.name',
            message: 'Project name is required',
            value: body.project.name,
            constraint: 'required'
          });
        }

        if (body.project.name && body.project.name.length > 100) {
          errors.push({
            field: 'project.name',
            message: 'Project name must be less than 100 characters',
            value: body.project.name,
            constraint: 'maxLength'
          });
        }

        if (body.project.repositoryUrl && !this.isValidUrl(body.project.repositoryUrl)) {
          errors.push({
            field: 'project.repositoryUrl',
            message: 'Invalid repository URL format',
            value: body.project.repositoryUrl,
            constraint: 'url'
          });
        }
      }

      // Validate files
      if (!body.files || !Array.isArray(body.files) || body.files.length === 0) {
        errors.push({
          field: 'files',
          message: 'At least one file must be submitted',
          constraint: 'required'
        });
      } else {
        if (body.files.length > this.MAX_FILES) {
          errors.push({
            field: 'files',
            message: `Maximum ${this.MAX_FILES} files allowed`,
            value: body.files.length,
            constraint: 'maxFiles'
          });
        }

        let totalSize = 0;
        body.files.forEach((file, index) => {
          const prefix = `files[${index}]`;
          
          if (!file.path || file.path.trim().length === 0) {
            errors.push({
              field: `${prefix}.path`,
              message: 'File path is required',
              constraint: 'required'
            });
          }

          if (!file.content || file.content.trim().length === 0) {
            errors.push({
              field: `${prefix}.content`,
              message: 'File content is required',
              constraint: 'required'
            });
          }

          if (!file.language || !this.SUPPORTED_LANGUAGES.includes(file.language)) {
            errors.push({
              field: `${prefix}.language`,
              message: `Language must be one of: ${this.SUPPORTED_LANGUAGES.join(', ')}`,
              value: file.language,
              constraint: 'enum'
            });
          }

          if (file.size && file.size > this.MAX_FILE_SIZE) {
            errors.push({
              field: `${prefix}.size`,
              message: `File size exceeds maximum of ${this.MAX_FILE_SIZE} bytes`,
              value: file.size,
              constraint: 'maxSize'
            });
          }

          totalSize += file.size || 0;
        });

        if (totalSize > this.MAX_CONTENT_LENGTH) {
          errors.push({
            field: 'files',
            message: `Total content size exceeds maximum of ${this.MAX_CONTENT_LENGTH} bytes`,
            value: totalSize,
            constraint: 'maxTotalSize'
          });
        }
      }

      // Validate options
      if (body.options) {
        if (!this.SUPPORTED_FRAMEWORKS.includes(body.options.scanType)) {
          errors.push({
            field: 'options.scanType',
            message: `Scan type must be one of: security, performance, gas-optimization, full`,
            value: body.options.scanType,
            constraint: 'enum'
          });
        }

        if (!['low', 'medium', 'high', 'critical'].includes(body.options.severity)) {
          errors.push({
            field: 'options.severity',
            message: `Severity must be one of: low, medium, high, critical`,
            value: body.options.severity,
            constraint: 'enum'
          });
        }
      }

      // Validate metadata
      if (body.metadata) {
        if (body.metadata.framework && !this.SUPPORTED_FRAMEWORKS.includes(body.metadata.framework)) {
          errors.push({
            field: 'metadata.framework',
            message: `Framework must be one of: ${this.SUPPORTED_FRAMEWORKS.join(', ')}`,
            value: body.metadata.framework,
            constraint: 'enum'
          });
        }

        // Soroban-specific validation
        if (body.metadata.framework === 'soroban') {
          this.validateSorobanProject(body.files, body.metadata, errors);
        }
      }

      if (errors.length > 0) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            timestamp: new Date().toISOString(),
            requestId: req.headers['x-request-id'] as string || 'unknown'
          },
          validationErrors: errors
        });
        return;
      }

      next();
    } catch (error) {
      res.status(500).json({
        error: {
          code: 'VALIDATION_EXCEPTION',
          message: 'An error occurred during validation',
          timestamp: new Date().toISOString(),
          requestId: req.headers['x-request-id'] as string || 'unknown'
        }
      });
    }
  }

  private static validateSorobanProject(files: any[], metadata: any, errors: ValidationError[]): void {
    const rustFiles = files.filter(f => f.language === 'rust');
    
    if (rustFiles.length === 0) {
      errors.push({
        field: 'files',
        message: 'Soroban projects must contain at least one Rust file',
        constraint: 'sorobanRequiresRust'
      });
      return;
    }

    // Check for Cargo.toml
    const hasCargoToml = files.some(f => f.path === 'Cargo.toml' || f.path.endsWith('/Cargo.toml'));
    if (!hasCargoToml) {
      errors.push({
        field: 'files',
        message: 'Soroban projects must include a Cargo.toml file',
        constraint: 'sorobanRequiresCargoToml'
      });
    }

    // Validate Soroban-specific dependencies in Cargo.toml if present
    const cargoToml = files.find(f => f.path.endsWith('Cargo.toml'));
    if (cargoToml) {
      const content = cargoToml.content;
      const hasSorobanSdk = content.includes('soroban-sdk') || content.includes('stellar-sdk');
      
      if (!hasSorobanSdk) {
        errors.push({
          field: 'metadata.dependencies',
          message: 'Soroban projects must include soroban-sdk or stellar-sdk dependency',
          constraint: 'sorobanRequiresSdk'
        });
      }
    }

    // Check for contract structure
    const contractFiles = rustFiles.filter(f => 
      f.content.includes('#[contractimpl]') || 
      f.content.includes('soroban_sdk::contract') ||
      f.content.includes('ContractType')
    );

    if (contractFiles.length === 0) {
      errors.push({
        field: 'files',
        message: 'No Soroban contract implementation found. Files should contain #[contractimpl] or contract definitions.',
        constraint: 'sorobanRequiresContract'
      });
    }
  }

  private static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}
