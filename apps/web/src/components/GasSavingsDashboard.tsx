import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

interface DashboardData {
  overview: {
    totalSavings: number;
    totalProjects: number;
    totalRules: number;
  };
  projectSavings: Array<{
    projectId: string;
    scanCount: number;
    issueCount: number;
    totalGasSaved: number;
  }>;
  ruleSavings: Array<{
    ruleId: string;
    ruleName: string;
    applicationCount: number;
    totalGasSaved: number;
    averageGasSaved: number;
  }>;
  severityBreakdown: Array<{
    severity: number;
    severityName: string;
    issueCount: number;
    totalGasSaved: number;
  }>;
  topOptimizations: Array<{
    fileName: string;
    ruleName: string;
    description: string;
    gasSaved: number;
    lineNumber: number;
    severity: number;
  }>;
  recentActivity: Array<{
    timeBucket: string;
    issueCount: number;
    totalGasSaved: number;
    scanCount: number;
  }>;
}

export const GasSavingsDashboard: React.FC = () => {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [selectedProject, setSelectedProject] = useState<string>('all-projects');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Core fetch function extracted to accept an optional abort signal
  const fetchDashboardData = React.useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);

      const isFiltered = selectedProject && selectedProject !== 'all-projects';
      const queryParam = isFiltered ? `?projectId=${encodeURIComponent(selectedProject)}` : '';
      
      const response = await fetch(`/api/analytics/dashboard${queryParam}`, { signal });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch dashboard data (Status: ${response.status})`);
      }
      
      const data = await response.json();
      setDashboardData(data);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return; // Ignore fetch cancellations safely
      }
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }, [selectedProject]);

  useEffect(() => {
    const controller = new AbortController();
    fetchDashboardData(controller.signal);

    return () => {
      controller.abort(); // Safely aborts out-of-order race conditions
    };
  }, [fetchDashboardData]);

  const formatGasSavings = (gas: number): string => {
    return new Intl.NumberFormat(undefined, { notation: gas >= 1_000_000 ? 'compact' : 'standard' }).format(gas);
  };

  const getSeverityColor = (severity: number): string => {
    switch (severity) {
      case 1: return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 2: return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 3: return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
      case 4: return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
    }
  };

  if (loading && !dashboardData) {
    return (
      <div className="flex flex-col items-center justify-center h-96 space-y-4" aria-busy="true">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-muted border-b-primary"></div>
        <p className="text-sm text-muted-foreground animate-pulse">Aggregating chain diagnostics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-96 max-w-md mx-auto text-center px-4">
        <div className="p-3 bg-red-100 rounded-full text-red-600 mb-4">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
        </div>
        <h3 className="text-lg font-semibold mb-2">Analytics Sync Faulted</h3>
        <p className="text-sm text-muted-foreground mb-6">{error}</p>
        <Button onClick={() => fetchDashboardData()} className="w-full">
          Retry Sync Sequence
        </Button>
      </div>
    );
  }

  if (!dashboardData) return <div className="p-8 text-center text-muted-foreground">No dashboard context loaded.</div>;

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Action Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b pb-5">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Gas Analytics Engine</h1>
          <p className="text-sm text-muted-foreground mt-1">Audit profile detailing optimization yields and EVM efficiencies.</p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <Button 
            variant="outline" 
            size="icon" 
            onClick={() => fetchDashboardData()} 
            disabled={loading}
            title="Refresh Ledger"
          >
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.253 8H18" />
            </svg>
          </Button>
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue placeholder="Scope Isolation Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all-projects">All Projects Consolidated</SelectItem>
              {dashboardData.projectSavings.map((project) => (
                <SelectItem key={project.projectId} value={project.projectId}>
                  {project.projectId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Metrics Array */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="relative overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Aggregated Savings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-emerald-600 tracking-tight">
              {formatGasSavings(dashboardData.overview.totalSavings)} <span className="text-sm font-normal text-muted-foreground">gas</span>
            </div>
            <div className="absolute top-0 right-0 w-24 h-full bg-emerald-500/5 [mask-image:linear-gradient(to_left,white,transparent)] pointer-events-none" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Scanned Entities</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight text-blue-600">
              {dashboardData.overview.totalProjects}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Static Constraints</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight text-purple-600">
              {dashboardData.overview.totalRules}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Primary Analytics Deck */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Project Distributions */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="text-lg">Project Ledger Distribution</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto max-h-[350px]">
            <div className="divide-y space-y-3">
              {dashboardData.projectSavings.slice(0, 5).map((project) => (
                <div key={project.projectId} className="flex justify-between items-center pt-3 first:pt-0">
                  <div>
                    <p className="font-semibold text-sm">{project.projectId}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {project.scanCount} compilations • {project.issueCount} distinct triggers
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-emerald-600 text-sm">
                      +{formatGasSavings(project.totalGasSaved)} gas
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Rule Impact Mapping */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="text-lg">Optimization Rule Dominance</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto max-h-[350px]">
            <div className="divide-y space-y-3">
              {dashboardData.ruleSavings.slice(0, 5).map((rule) => (
                <div key={rule.ruleId} className="flex justify-between items-center pt-3 first:pt-0">
                  <div className="pr-4">
                    <p className="font-semibold text-sm line-clamp-1">{rule.ruleName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Applied {rule.applicationCount} times
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-emerald-600 text-sm">
                      {formatGasSavings(rule.totalGasSaved)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      ø {formatGasSavings(Math.round(rule.averageGasSaved))}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Fault Severity Index */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="text-lg">Structural Density Profile</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto max-h-[350px]">
            <div className="divide-y space-y-3">
              {dashboardData.severityBreakdown.map((severity) => (
                <div key={severity.severity} className="flex justify-between items-center pt-3 first:pt-0">
                  <div className="flex items-center space-x-3">
                    <Badge className={`${getSeverityColor(severity.severity)} border-none shadow-none`}>
                      {severity.severityName}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {severity.issueCount} nodes found
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-emerald-600 text-sm">
                      {formatGasSavings(severity.totalGasSaved)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Time Bucket Streams */}
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="text-lg">Yield Pipeline History</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto max-h-[350px]">
            <div className="divide-y space-y-3">
              {dashboardData.recentActivity.slice(-7).reverse().map((activity, index) => (
                <div key={index} className="flex justify-between items-center pt-3 first:pt-0">
                  <div>
                    <p className="font-medium text-sm">{activity.timeBucket}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {activity.scanCount} batch pipelines executed
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-emerald-600 text-sm">
                      {formatGasSavings(activity.totalGasSaved)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {activity.issueCount} variants addressed
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Optimization Targets */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Primary Re-architecting Candidates</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {dashboardData.topOptimizations.map((optimization, index) => (
              <div key={index} className="border rounded-xl p-4 hover:bg-muted/30 transition-colors">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={`${getSeverityColor(optimization.severity)} border-none shadow-none text-[11px]`}>
                        {optimization.severity === 1 ? 'Info' : 
                         optimization.severity === 2 ? 'Warning' :
                         optimization.severity === 3 ? 'Error' : 'Critical'}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                        {optimization.fileName}:{optimization.lineNumber}
                      </span>
                    </div>
                    <h4 className="text-sm font-semibold">{optimization.ruleName}</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {optimization.description}
                    </p>
                  </div>
                  <div className="text-right shrink-0 w-full sm:w-auto border-t sm:border-none pt-2 sm:pt-0">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Expected Yield</span>
                    <p className="font-extrabold text-emerald-600 text-base sm:text-lg">
                      {formatGasSavings(optimization.gasSaved)} <span className="text-xs font-normal">gas</span>
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};