/**
 * Security Incident Response Module
 * 
 * Provides utilities for incident tracking, classification, and response coordination.
 * This module supports the security incident response procedure documented in
 * docs/SECURITY_INCIDENT_RESPONSE.md
 */

export enum IncidentSeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export enum IncidentType {
  CODE_VULNERABILITY = 'code_vulnerability',
  DEPENDENCY_VULNERABILITY = 'dependency_vulnerability',
  INFRASTRUCTURE_BREACH = 'infrastructure_breach',
  DATA_EXPOSURE = 'data_exposure',
  SUPPLY_CHAIN_ATTACK = 'supply_chain_attack',
  SOCIAL_ENGINEERING = 'social_engineering',
  DOS_ATTACK = 'dos_attack',
}

export enum IncidentStatus {
  REPORTED = 'reported',
  TRIAGED = 'triaged',
  INVESTIGATING = 'investigating',
  CONTAINED = 'contained',
  ERADICATED = 'eradicated',
  RECOVERING = 'recovering',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

export interface SecurityIncident {
  id: string;
  title: string;
  description: string;
  type: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  reportedAt: Date;
  reportedBy: string;
  assignedTo?: string;
  affectedSystems: string[];
  impactAssessment?: string;
  rootCause?: string;
  remediationSteps: string[];
  resolvedAt?: Date;
  metadata: Record<string, unknown>;
}

export interface IncidentMetrics {
  totalIncidents: number;
  incidentsBySeverity: Record<IncidentSeverity, number>;
  incidentsByType: Record<IncidentType, number>;
  averageResponseTime: number; // in hours
  averageResolutionTime: number; // in hours
  openIncidents: number;
}

/**
 * Calculate response time SLA based on severity
 */
export function getResponseTimeSLA(severity: IncidentSeverity): number {
  const slaHours: Record<IncidentSeverity, number> = {
    [IncidentSeverity.CRITICAL]: 1,
    [IncidentSeverity.HIGH]: 4,
    [IncidentSeverity.MEDIUM]: 24,
    [IncidentSeverity.LOW]: 168, // 7 days
  };
  return slaHours[severity];
}

/**
 * Classify incident severity based on impact and exploitability
 */
export function classifyIncidentSeverity(
  impact: 'high' | 'medium' | 'low',
  exploitability: 'active' | 'easy' | 'difficult' | 'theoretical',
): IncidentSeverity {
  if (impact === 'high' && (exploitability === 'active' || exploitability === 'easy')) {
    return IncidentSeverity.CRITICAL;
  }
  if (impact === 'high' || (impact === 'medium' && exploitability === 'active')) {
    return IncidentSeverity.HIGH;
  }
  if (impact === 'medium' || (impact === 'low' && exploitability !== 'theoretical')) {
    return IncidentSeverity.MEDIUM;
  }
  return IncidentSeverity.LOW;
}

/**
 * Generate unique incident ID
 */
export function generateIncidentId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `INC-${timestamp}-${random}`.toUpperCase();
}

/**
 * Check if incident is within SLA for response time
 */
export function isWithinResponseSLA(incident: SecurityIncident): boolean {
  if (incident.status === IncidentStatus.REPORTED) {
    const slaHours = getResponseTimeSLA(incident.severity);
    const hoursSinceReport = (Date.now() - incident.reportedAt.getTime()) / (1000 * 60 * 60);
    return hoursSinceReport <= slaHours;
  }
  return true; // Already triaged or beyond initial response
}

/**
 * Calculate time to resolution in hours
 */
export function calculateResolutionTime(incident: SecurityIncident): number | null {
  if (!incident.resolvedAt) {
    return null;
  }
  return (incident.resolvedAt.getTime() - incident.reportedAt.getTime()) / (1000 * 60 * 60);
}

/**
 * Get recommended containment actions based on incident type
 */
export function getContainmentActions(type: IncidentType): string[] {
  const actions: Record<IncidentType, string[]> = {
    [IncidentType.CODE_VULNERABILITY]: [
      'Disable affected feature or endpoint if exploitable',
      'Deploy emergency patch or workaround',
      'Review access logs for exploitation attempts',
      'Notify users if data may be compromised',
    ],
    [IncidentType.DEPENDENCY_VULNERABILITY]: [
      'Assess if vulnerability affects GasGuard usage',
      'Update to patched version immediately',
      'Review dependency usage in codebase',
      'Consider temporary removal if no patch available',
    ],
    [IncidentType.INFRASTRUCTURE_BREACH]: [
      'Isolate compromised systems immediately',
      'Revoke all credentials and access tokens',
      'Enable enhanced monitoring and logging',
      'Preserve forensic evidence',
    ],
    [IncidentType.DATA_EXPOSURE]: [
      'Identify scope of exposed data',
      'Revoke exposed credentials immediately',
      'Remove exposed data from public access',
      'Notify affected users per regulatory requirements',
    ],
    [IncidentType.SUPPLY_CHAIN_ATTACK]: [
      'Identify compromised dependency or tool',
      'Rollback to known-good version',
      'Audit all code changes from compromised source',
      'Scan for malicious artifacts',
    ],
    [IncidentType.SOCIAL_ENGINEERING]: [
      'Revoke compromised account access',
      'Reset passwords and enable MFA',
      'Review account activity for unauthorized actions',
      'Conduct security awareness training',
    ],
    [IncidentType.DOS_ATTACK]: [
      'Enable rate limiting and traffic filtering',
      'Block malicious IP addresses',
      'Scale infrastructure if necessary',
      'Activate DDoS mitigation service',
    ],
  };
  return actions[type] || [];
}

/**
 * Validate incident report completeness
 */
export function validateIncidentReport(incident: Partial<SecurityIncident>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!incident.title || incident.title.trim().length === 0) {
    errors.push('Title is required');
  }
  if (!incident.description || incident.description.trim().length < 10) {
    errors.push('Description must be at least 10 characters');
  }
  if (!incident.type) {
    errors.push('Incident type is required');
  }
  if (!incident.severity) {
    errors.push('Severity is required');
  }
  if (!incident.reportedBy || incident.reportedBy.trim().length === 0) {
    errors.push('Reporter information is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Format incident for notification
 */
export function formatIncidentNotification(incident: SecurityIncident): string {
  const severity = incident.severity.toUpperCase();
  const status = incident.status.replace('_', ' ').toUpperCase();
  
  return `
🚨 Security Incident Alert

ID: ${incident.id}
Severity: ${severity}
Type: ${incident.type.replace(/_/g, ' ')}
Status: ${status}

${incident.title}

Reported: ${incident.reportedAt.toISOString()}
Affected Systems: ${incident.affectedSystems.join(', ') || 'Unknown'}

Description:
${incident.description}

SLA Response Time: ${getResponseTimeSLA(incident.severity)} hours
Within SLA: ${isWithinResponseSLA(incident) ? 'Yes' : 'No'}
`.trim();
}

/**
 * Generate incident metrics from a list of incidents
 */
export function calculateIncidentMetrics(incidents: SecurityIncident[]): IncidentMetrics {
  const metrics: IncidentMetrics = {
    totalIncidents: incidents.length,
    incidentsBySeverity: {
      [IncidentSeverity.CRITICAL]: 0,
      [IncidentSeverity.HIGH]: 0,
      [IncidentSeverity.MEDIUM]: 0,
      [IncidentSeverity.LOW]: 0,
    },
    incidentsByType: {
      [IncidentType.CODE_VULNERABILITY]: 0,
      [IncidentType.DEPENDENCY_VULNERABILITY]: 0,
      [IncidentType.INFRASTRUCTURE_BREACH]: 0,
      [IncidentType.DATA_EXPOSURE]: 0,
      [IncidentType.SUPPLY_CHAIN_ATTACK]: 0,
      [IncidentType.SOCIAL_ENGINEERING]: 0,
      [IncidentType.DOS_ATTACK]: 0,
    },
    averageResponseTime: 0,
    averageResolutionTime: 0,
    openIncidents: 0,
  };

  let totalResponseTime = 0;
  let totalResolutionTime = 0;
  let resolvedCount = 0;

  for (const incident of incidents) {
    // Count by severity
    metrics.incidentsBySeverity[incident.severity]++;
    
    // Count by type
    metrics.incidentsByType[incident.type]++;
    
    // Count open incidents
    if (incident.status !== IncidentStatus.RESOLVED && incident.status !== IncidentStatus.CLOSED) {
      metrics.openIncidents++;
    }
    
    // Calculate resolution time for resolved incidents
    if (incident.resolvedAt) {
      const resolutionTime = calculateResolutionTime(incident);
      if (resolutionTime !== null) {
        totalResolutionTime += resolutionTime;
        resolvedCount++;
      }
    }
    
    // Estimate response time (assume triage happens when status changes from REPORTED)
    if (incident.status !== IncidentStatus.REPORTED) {
      totalResponseTime += getResponseTimeSLA(incident.severity); // Placeholder estimation
    }
  }

  if (incidents.length > 0) {
    metrics.averageResponseTime = totalResponseTime / incidents.length;
  }
  
  if (resolvedCount > 0) {
    metrics.averageResolutionTime = totalResolutionTime / resolvedCount;
  }

  return metrics;
}

export default {
  IncidentSeverity,
  IncidentType,
  IncidentStatus,
  getResponseTimeSLA,
  classifyIncidentSeverity,
  generateIncidentId,
  isWithinResponseSLA,
  calculateResolutionTime,
  getContainmentActions,
  validateIncidentReport,
  formatIncidentNotification,
  calculateIncidentMetrics,
};
