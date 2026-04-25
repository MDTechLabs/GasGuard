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
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardData();
  }, [selectedProject]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/analytics/dashboard${selectedProject ? `?projectId=${selectedProject}` : ''}`);
      if (!response.ok) {
        throw new Error('Failed to fetch dashboard data');
      }
      const data = await response.json();
      setDashboardData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const formatGasSavings = (gas: number): string => {
    return new Intl.NumberFormat().format(gas);
  };

  const getSeverityColor = (severity: number): string => {
    switch (severity) {
      case 1: return 'bg-blue-100 text-blue-800';
      case 2: return 'bg-yellow-100 text-yellow-800';
      case 3: return 'bg-orange-100 text-orange-800';
      case 4: return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600">Error: {error}</p>
        <Button onClick={fetchDashboardData} className="mt-4">
          Retry
        </Button>
      </div>
    );
  }

  if (!dashboardData) {
    return <div>No data available</div>;
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Gas Savings Dashboard</h1>
        <Select value={selectedProject} onValueChange={setSelectedProject}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select a project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Projects</SelectItem>
            {dashboardData.projectSavings.map((project) => (
              <SelectItem key={project.projectId} value={project.projectId}>
                {project.projectId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Total Gas Savings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatGasSavings(dashboardData.overview.totalSavings)} gas
            </div>
            <p className="text-sm text-gray-600">Across all optimizations</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Projects Analyzed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {dashboardData.overview.totalProjects}
            </div>
            <p className="text-sm text-gray-600">Total projects</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rules Applied</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {dashboardData.overview.totalRules}
            </div>
            <p className="text-sm text-gray-600">Different optimization rules</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Project Savings */}
        <Card>
          <CardHeader>
            <CardTitle>Gas Savings by Project</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {dashboardData.projectSavings.slice(0, 5).map((project) => (
                <div key={project.projectId} className="flex justify-between items-center">
                  <div>
                    <p className="font-medium">{project.projectId}</p>
                    <p className="text-sm text-gray-600">
                      {project.scanCount} scans, {project.issueCount} issues
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-green-600">
                      {formatGasSavings(project.totalGasSaved)} gas
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Rule Effectiveness */}
        <Card>
          <CardHeader>
            <CardTitle>Most Effective Rules</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {dashboardData.ruleSavings.slice(0, 5).map((rule) => (
                <div key={rule.ruleId} className="flex justify-between items-center">
                  <div>
                    <p className="font-medium">{rule.ruleName}</p>
                    <p className="text-sm text-gray-600">
                      {rule.applicationCount} applications
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-green-600">
                      {formatGasSavings(rule.totalGasSaved)} gas
                    </p>
                    <p className="text-xs text-gray-600">
                      avg: {formatGasSavings(Math.round(rule.averageGasSaved))}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Severity Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Issues by Severity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {dashboardData.severityBreakdown.map((severity) => (
                <div key={severity.severity} className="flex justify-between items-center">
                  <div className="flex items-center space-x-2">
                    <Badge className={getSeverityColor(severity.severity)}>
                      {severity.severityName}
                    </Badge>
                    <span className="text-sm text-gray-600">
                      {severity.issueCount} issues
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-green-600">
                      {formatGasSavings(severity.totalGasSaved)} gas
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {dashboardData.recentActivity.slice(-7).reverse().map((activity, index) => (
                <div key={index} className="flex justify-between items-center">
                  <div>
                    <p className="font-medium">{activity.timeBucket}</p>
                    <p className="text-sm text-gray-600">
                      {activity.scanCount} scans
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-green-600">
                      {formatGasSavings(activity.totalGasSaved)} gas
                    </p>
                    <p className="text-xs text-gray-600">
                      {activity.issueCount} issues
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Optimizations */}
      <Card>
        <CardHeader>
          <CardTitle>Top Optimization Opportunities</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {dashboardData.topOptimizations.map((optimization, index) => (
              <div key={index} className="border rounded-lg p-4">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-1">
                      <Badge className={getSeverityColor(optimization.severity)}>
                        {optimization.severity === 1 ? 'Info' : 
                         optimization.severity === 2 ? 'Warning' :
                         optimization.severity === 3 ? 'Error' : 'Critical'}
                      </Badge>
                      <span className="font-medium">{optimization.fileName}:{optimization.lineNumber}</span>
                    </div>
                    <p className="text-sm font-medium text-gray-800 mb-1">
                      {optimization.ruleName}
                    </p>
                    <p className="text-sm text-gray-600 mb-2">
                      {optimization.description}
                    </p>
                  </div>
                  <div className="text-right ml-4">
                    <p className="font-bold text-green-600 text-lg">
                      {formatGasSavings(optimization.gasSaved)} gas
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
