/**
 * Configuration Schema Definitions
 * 
 * JSON Schema definitions for configuration validation
 */

export const CONFIGURATION_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  title: "GasGuard Configuration",
  description: "Configuration schema for GasGuard rule engine",
  required: ["version", "system", "rules"],
  properties: {
    version: {
      type: "string",
      pattern: "^\\d+\\.\\d+\\.\\d+(-.*)?$",
      description: "Configuration version (semantic versioning)"
    },
    lastUpdated: {
      type: "string",
      format: "date-time",
      description: "Last updated timestamp"
    },
    system: {
      $ref: "#/definitions/SystemConfiguration"
    },
    rules: {
      type: "array",
      items: {
        $ref: "#/definitions/RuleConfiguration"
      },
      description: "Array of rule configurations"
    },
    profiles: {
      type: "array",
      items: {
        $ref: "#/definitions/ConfigurationProfile"
      },
      description: "Configuration profiles for different use cases"
    }
  },
  definitions: {
    SystemConfiguration: {
      type: "object",
      required: ["version", "environment", "logging", "performance", "security", "features"],
      properties: {
        version: {
          type: "string",
          description: "System version"
        },
        environment: {
          type: "string",
          enum: ["development", "staging", "production"],
          description: "Runtime environment"
        },
        logging: {
          $ref: "#/definitions/LoggingConfiguration"
        },
        performance: {
          $ref: "#/definitions/PerformanceConfiguration"
        },
        security: {
          $ref: "#/definitions/SecurityConfiguration"
        },
        features: {
          $ref: "#/definitions/FeatureConfiguration"
        }
      }
    },
    LoggingConfiguration: {
      type: "object",
      required: ["level", "enableConsole", "enableFile", "enableAudit"],
      properties: {
        level: {
          type: "string",
          enum: ["debug", "info", "warn", "error"],
          description: "Minimum log level"
        },
        enableConsole: {
          type: "boolean",
          description: "Enable console logging"
        },
        enableFile: {
          type: "boolean",
          description: "Enable file logging"
        },
        enableAudit: {
          type: "boolean",
          description: "Enable audit logging"
        }
      }
    },
    PerformanceConfiguration: {
      type: "object",
      required: ["maxConcurrency", "timeoutMs", "enableParallelExecution"],
      properties: {
        maxConcurrency: {
          type: "integer",
          minimum: 1,
          maximum: 32,
          description: "Maximum concurrent rule executions"
        },
        timeoutMs: {
          type: "integer",
          minimum: 0,
          description: "Timeout in milliseconds for rule execution"
        },
        enableParallelExecution: {
          type: "boolean",
          description: "Enable parallel rule execution"
        }
      }
    },
    SecurityConfiguration: {
      type: "object",
      required: ["enableApiKeyValidation", "enableRateLimiting", "maxRequestsPerMinute"],
      properties: {
        enableApiKeyValidation: {
          type: "boolean",
          description: "Enable API key validation"
        },
        enableRateLimiting: {
          type: "boolean",
          description: "Enable rate limiting"
        },
        maxRequestsPerMinute: {
          type: "integer",
          minimum: 1,
          description: "Maximum requests per minute"
        }
      }
    },
    FeatureConfiguration: {
      type: "object",
      required: ["enableAutoFix", "enableDetailedReporting", "enableRealTimeMonitoring"],
      properties: {
        enableAutoFix: {
          type: "boolean",
          description: "Enable automatic fix suggestions"
        },
        enableDetailedReporting: {
          type: "boolean",
          description: "Enable detailed reporting"
        },
        enableRealTimeMonitoring: {
          type: "boolean",
          description: "Enable real-time monitoring"
        }
      }
    },
    RuleConfiguration: {
      type: "object",
      required: ["id", "name", "enabled", "severity", "category", "language"],
      properties: {
        id: {
          type: "string",
          pattern: "^[a-z0-9-]+$",
          description: "Unique rule identifier"
        },
        name: {
          type: "string",
          description: "Human-readable rule name"
        },
        enabled: {
          type: "boolean",
          description: "Whether the rule is enabled"
        },
        severity: {
          type: "string",
          enum: ["critical", "high", "medium", "low", "info"],
          description: "Rule severity level"
        },
        category: {
          type: "string",
          description: "Rule category"
        },
        language: {
          type: "string",
          description: "Target programming language"
        },
        description: {
          type: "string",
          description: "Rule description"
        },
        parameters: {
          type: "object",
          description: "Rule-specific parameters"
        },
        dependencies: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Rule dependencies"
        },
        tags: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Rule tags"
        },
        customRules: {
          $ref: "#/definitions/CustomRules"
        }
      }
    },
    CustomRules: {
      type: "object",
      required: ["enabled", "conditions", "actions"],
      properties: {
        enabled: {
          type: "boolean",
          description: "Whether custom rules are enabled"
        },
        conditions: {
          type: "array",
          items: {
            $ref: "#/definitions/RuleCondition"
          },
          description: "Custom rule conditions"
        },
        actions: {
          type: "array",
          items: {
            $ref: "#/definitions/RuleAction"
          },
          description: "Custom rule actions"
        }
      }
    },
    RuleCondition: {
      type: "object",
      required: ["field", "operator", "value"],
      properties: {
        field: {
          type: "string",
          description: "Field to evaluate"
        },
        operator: {
          type: "string",
          enum: ["equals", "not_equals", "contains", "not_contains", "greater_than", "less_than", "in", "not_in"],
          description: "Comparison operator"
        },
        value: {
          description: "Value to compare against"
        },
        caseSensitive: {
          type: "boolean",
          default: true,
          description: "Whether comparison is case sensitive"
        }
      }
    },
    RuleAction: {
      type: "object",
      required: ["type"],
      properties: {
        type: {
          type: "string",
          enum: ["warn", "error", "info", "custom"],
          description: "Action type"
        },
        message: {
          type: "string",
          description: "Action message"
        },
        severity: {
          type: "string",
          enum: ["critical", "high", "medium", "low", "info"],
          description: "Action severity"
        },
        metadata: {
          type: "object",
          description: "Additional metadata"
        }
      }
    },
    ConfigurationProfile: {
      type: "object",
      required: ["name", "description", "rules"],
      properties: {
        name: {
          type: "string",
          description: "Profile name"
        },
        description: {
          type: "string",
          description: "Profile description"
        },
        rules: {
          type: "array",
          items: {
            $ref: "#/definitions/RuleConfiguration"
          },
          description: "Rule configurations for this profile"
        },
        systemOverrides: {
          $ref: "#/definitions/SystemConfiguration",
          description: "System configuration overrides"
        }
      }
    }
  }
};

export const RULE_CONFIGURATION_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  title: "Rule Configuration",
  required: ["id", "name", "enabled", "severity", "category", "language"],
  properties: {
    id: {
      type: "string",
      pattern: "^[a-z0-9-]+$",
      description: "Unique rule identifier"
    },
    name: {
      type: "string",
      description: "Human-readable rule name"
    },
    enabled: {
      type: "boolean",
      description: "Whether the rule is enabled"
    },
    severity: {
      type: "string",
      enum: ["critical", "high", "medium", "low", "info"],
      description: "Rule severity level"
    },
    category: {
      type: "string",
      description: "Rule category"
    },
    language: {
      type: "string",
      description: "Target programming language"
    },
    description: {
      type: "string",
      description: "Rule description"
    },
    parameters: {
      type: "object",
      description: "Rule-specific parameters"
    },
    dependencies: {
      type: "array",
      items: {
        type: "string"
      },
      description: "Rule dependencies"
    },
    tags: {
      type: "array",
      items: {
        type: "string"
      },
      description: "Rule tags"
    },
    customRules: {
      $ref: "#/definitions/CustomRules"
    }
  },
  definitions: {
    CustomRules: CONFIGURATION_SCHEMA.definitions.CustomRules
  }
};
