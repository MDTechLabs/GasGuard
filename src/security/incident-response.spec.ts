/**
 * Unit tests for Security Incident Response Module
 */

import {
  IncidentSeverity,
  IncidentType,
  IncidentStatus,
  SecurityIncident,
  getResponseTimeSLA,
  classifyIncidentSeverity,
  generateIncidentId,
  isWithinResponseSLA,
  calculateResolutionTime,
  getContainmentActions,
  validateIncidentReport,
  formatIncidentNotification,
  calculateIncidentMetrics,
} from './incident-response';

describe('Security Incident Response', () => {
  describe('getResponseTimeSLA', () => {
    it('should return correct SLA for each severity level', () => {
      expect(getResponseTimeSLA(IncidentSeverity.CRITICAL)).toBe(1);
      expect(getResponseTimeSLA(IncidentSeverity.HIGH)).toBe(4);
      expect(getResponseTimeSLA(IncidentSeverity.MEDIUM)).toBe(24);
      expect(getResponseTimeSLA(IncidentSeverity.LOW)).toBe(168);
    });
  });

  describe('classifyIncidentSeverity', () => {
    it('should classify as CRITICAL for high impact with active exploitation', () => {
      expect(classifyIncidentSeverity('high', 'active')).toBe(IncidentSeverity.CRITICAL);
    });

    it('should classify as CRITICAL for high impact with easy exploitation', () => {
      expect(classifyIncidentSeverity('high', 'easy')).toBe(IncidentSeverity.CRITICAL);
    });

    it('should classify as HIGH for high impact with difficult exploitation', () => {
      expect(classifyIncidentSeverity('high', 'difficult')).toBe(IncidentSeverity.HIGH);
    });

    it('should classify as HIGH for medium impact with active exploitation', () => {
      expect(classifyIncidentSeverity('medium', 'active')).toBe(IncidentSeverity.HIGH);
    });

    it('should classify as MEDIUM for medium impact with easy exploitation', () => {
      expect(classifyIncidentSeverity('medium', 'easy')).toBe(IncidentSeverity.MEDIUM);
    });

    it('should classify as LOW for low impact with theoretical exploitation', () => {
      expect(classifyIncidentSeverity('low', 'theoretical')).toBe(IncidentSeverity.LOW);
    });
  });

  describe('generateIncidentId', () => {
    it('should generate unique incident IDs', () => {
      const id1 = generateIncidentId();
      const id2 = generateIncidentId();
      
      expect(id1).toMatch(/^INC-\d+-[A-Z0-9]{6}$/);
      expect(id2).toMatch(/^INC-\d+-[A-Z0-9]{6}$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('isWithinResponseSLA', () => {
    it('should return true when incident is within SLA', () => {
      const incident: SecurityIncident = {
        id: 'INC-001',
        title: 'Test Incident',
        description: 'Test description',
        type: IncidentType.CODE_VULNERABILITY,
        severity: IncidentSeverity.CRITICAL,
        status: IncidentStatus.REPORTED,
        reportedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
        reportedBy: 'test@example.com',
        affectedSystems: [],
        remediationSteps: [],
        metadata: {},
      };

      expect(isWithinResponseSLA(incident)).toBe(true);
    });

    it('should return false when incident exceeds SLA', () => {
      const incident: SecurityIncident = {
        id: 'INC-002',
        title: 'Test Incident',
        description: 'Test description',
        type: IncidentType.CODE_VULNERABILITY,
        severity: IncidentSeverity.CRITICAL,
        status: IncidentStatus.REPORTED,
        reportedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        reportedBy: 'test@example.com',
        affectedSystems: [],
        remediationSteps: [],
        metadata: {},
      };

      expect(isWithinResponseSLA(incident)).toBe(false);
    });

    it('should return true when incident is already triaged', () => {
      const incident: SecurityIncident = {
        id: 'INC-003',
        title: 'Test Incident',
        description: 'Test description',
        type: IncidentType.CODE_VULNERABILITY,
        severity: IncidentSeverity.CRITICAL,
        status: IncidentStatus.INVESTIGATING,
        reportedAt: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 hours ago
        reportedBy: 'test@example.com',
        affectedSystems: [],
        remediationSteps: [],
        metadata: {},
      };

      expect(isWithinResponseSLA(incident)).toBe(true);
    });
  });

  describe('calculateResolutionTime', () => {
    it('should calculate resolution time correctly', () => {
      const reportedAt = new Date('2026-01-01T10:00:00Z');
      const resolvedAt = new Date('2026-01-01T14:00:00Z');
      
      const incident: SecurityIncident = {
        id: 'INC-004',
        title: 'Test Incident',
        description: 'Test description',
        type: IncidentType.CODE_VULNERABILITY,
        severity: IncidentSeverity.HIGH,
        status: IncidentStatus.RESOLVED,
        reportedAt,
        resolvedAt,
        reportedBy: 'test@example.com',
        affectedSystems: [],
        remediationSteps: [],
        metadata: {},
      };

      expect(calculateResolutionTime(incident)).toBe(4); // 4 hours
    });

    it('should return null for unresolved incidents', () => {
      const incident: SecurityIncident = {
        id: 'INC-005',
        title: 'Test Incident',
        description: 'Test description',
        type: IncidentType.CODE_VULNERABILITY,
        severity: IncidentSeverity.HIGH,
        status: IncidentStatus.INVESTIGATING,
        reportedAt: new Date(),
        reportedBy: 'test@example.com',
        affectedSystems: [],
        remediationSteps: [],
        metadata: {},
      };

      expect(calculateResolutionTime(incident)).toBeNull();
    });
  });

  describe('getContainmentActions', () => {
    it('should return appropriate actions for code vulnerability', () => {
      const actions = getContainmentActions(IncidentType.CODE_VULNERABILITY);
      expect(actions).toContain('Disable affected feature or endpoint if exploitable');
      expect(actions.length).toBeGreaterThan(0);
    });

    it('should return appropriate actions for dependency vulnerability', () => {
      const actions = getContainmentActions(IncidentType.DEPENDENCY_VULNERABILITY);
      expect(actions).toContain('Update to patched version immediately');
    });

    it('should return appropriate actions for infrastructure breach', () => {
      const actions = getContainmentActions(IncidentType.INFRASTRUCTURE_BREACH);
      expect(actions).toContain('Isolate compromised systems immediately');
    });

    it('should return appropriate actions for data exposure', () => {
      const actions = getContainmentActions(IncidentType.DATA_EXPOSURE);
      expect(actions).toContain('Identify scope of exposed data');
    });
  });

  describe('validateIncidentReport', () => {
    it('should validate complete incident report', () => {
      const incident = {
        title: 'Test Vulnerability',
        description: 'A detailed description of the vulnerability',
        type: IncidentType.CODE_VULNERABILITY,
        severity: IncidentSeverity.HIGH,
        reportedBy: 'security@example.com',
      };

      const result = validateIncidentReport(incident);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject incident without title', () => {
      const incident = {
        description: 'A detailed description',
        type: IncidentType.CODE_VULNERABILITY,
        severity: IncidentSeverity.HIGH,
        reportedBy: 'security@example.com',
      };

      const result = validateIncidentReport(incident);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Title is required');
    });

    it('should reject incident with short description', () => {
      const incident = {
        title: 'Test',
        description: 'Short',
        type: IncidentType.CODE_VULNERABILITY,
        severity: IncidentSeverity.HIGH,
        reportedBy: 'security@example.com',
      };

      const result = validateIncidentReport(incident);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Description must be at least 10 characters');
    });

    it('should reject incident without reporter', () => {
      const incident = {
        title: 'Test Vulnerability',
        description: 'A detailed description',
        type: IncidentType.CODE_VULNERABILITY,
        severity: IncidentSeverity.HIGH,
      };

      const result = validateIncidentReport(incident);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Reporter information is required');
    });
  });

  describe('formatIncidentNotification', () => {
    it('should format incident notification correctly', () => {
      const incident: SecurityIncident = {
        id: 'INC-123',
        title: 'Critical Vulnerability Found',
        description: 'SQL injection in user authentication',
        type: IncidentType.CODE_VULNERABILITY,
        severity: IncidentSeverity.CRITICAL,
        status: IncidentStatus.REPORTED,
        reportedAt: new Date('2026-09-30T12:00:00Z'),
        reportedBy: 'security@example.com',
        affectedSystems: ['API Server', 'Database'],
        remediationSteps: [],
        metadata: {},
      };

      const notification = formatIncidentNotification(incident);
      
      expect(notification).toContain('INC-123');
      expect(notification).toContain('CRITICAL');
      expect(notification).toContain('Critical Vulnerability Found');
      expect(notification).toContain('API Server, Database');
      expect(notification).toContain('SLA Response Time: 1 hours');
    });
  });

  describe('calculateIncidentMetrics', () => {
    it('should calculate metrics correctly for multiple incidents', () => {
      const incidents: SecurityIncident[] = [
        {
          id: 'INC-001',
          title: 'Incident 1',
          description: 'Description 1',
          type: IncidentType.CODE_VULNERABILITY,
          severity: IncidentSeverity.CRITICAL,
          status: IncidentStatus.RESOLVED,
          reportedAt: new Date('2026-09-01T10:00:00Z'),
          resolvedAt: new Date('2026-09-01T11:00:00Z'),
          reportedBy: 'user1',
          affectedSystems: [],
          remediationSteps: [],
          metadata: {},
        },
        {
          id: 'INC-002',
          title: 'Incident 2',
          description: 'Description 2',
          type: IncidentType.DEPENDENCY_VULNERABILITY,
          severity: IncidentSeverity.HIGH,
          status: IncidentStatus.INVESTIGATING,
          reportedAt: new Date('2026-09-02T10:00:00Z'),
          reportedBy: 'user2',
          affectedSystems: [],
          remediationSteps: [],
          metadata: {},
        },
        {
          id: 'INC-003',
          title: 'Incident 3',
          description: 'Description 3',
          type: IncidentType.CODE_VULNERABILITY,
          severity: IncidentSeverity.MEDIUM,
          status: IncidentStatus.RESOLVED,
          reportedAt: new Date('2026-09-03T10:00:00Z'),
          resolvedAt: new Date('2026-09-04T10:00:00Z'),
          reportedBy: 'user3',
          affectedSystems: [],
          remediationSteps: [],
          metadata: {},
        },
      ];

      const metrics = calculateIncidentMetrics(incidents);

      expect(metrics.totalIncidents).toBe(3);
      expect(metrics.incidentsBySeverity[IncidentSeverity.CRITICAL]).toBe(1);
      expect(metrics.incidentsBySeverity[IncidentSeverity.HIGH]).toBe(1);
      expect(metrics.incidentsBySeverity[IncidentSeverity.MEDIUM]).toBe(1);
      expect(metrics.incidentsByType[IncidentType.CODE_VULNERABILITY]).toBe(2);
      expect(metrics.incidentsByType[IncidentType.DEPENDENCY_VULNERABILITY]).toBe(1);
      expect(metrics.openIncidents).toBe(1);
      expect(metrics.averageResolutionTime).toBeGreaterThan(0);
    });

    it('should handle empty incident list', () => {
      const metrics = calculateIncidentMetrics([]);

      expect(metrics.totalIncidents).toBe(0);
      expect(metrics.openIncidents).toBe(0);
      expect(metrics.averageResponseTime).toBe(0);
      expect(metrics.averageResolutionTime).toBe(0);
    });
  });
});
