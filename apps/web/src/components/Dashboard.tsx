import React, { useState, useEffect } from 'react';
import { 
  Shield, 
  Zap, 
  BarChart3, 
  AlertTriangle, 
  CheckCircle2, 
  Search, 
  ChevronRight,
  FileCode,
  ArrowUpRight
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { FileDetails } from './FileDetails';

// Mock data for initial view
const MOCK_SUMMARY = {
  totalFiles: 42,
  totalIssues: 12,
  issuesBySeverity: {
    critical: 1,
    high: 3,
    medium: 5,
    low: 3
  },
  gasSavings: {
    totalGasSaved: 450000,
    percentageSaved: 12.5
  }
};

const SEVERITY_COLORS = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e'
};

export const Dashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'issues' | 'simulation'>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const severityData = Object.entries(MOCK_SUMMARY.issuesBySeverity).map(([name, value]) => ({
    name,
    value
  }));

  const mockIssues = [
    {
      title: "Unchecked Arithmetic in loop",
      severity: "critical",
      description: "Arithmetic operations in for-loops can overflow if not checked, although Solidity 0.8+ has built-in checks, they consume more gas than unchecked blocks.",
      location: { line: 142 },
      recommendation: "Wrap the increment in an unchecked block."
    },
    {
      title: "Redundant State Storage",
      severity: "high",
      description: "State variables are expensive to update. This variable is updated frequently in a loop.",
      location: { line: 89 },
      recommendation: "Use a local variable for intermediate calculations."
    }
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-8">
      {/* Drill-down Modal */}
      <FileDetails 
        isOpen={!!selectedFile} 
        onClose={() => setSelectedFile(null)} 
        fileName={selectedFile || ''}
        content={`// Code for ${selectedFile}\n\ncontract Staking {\n  uint256 public totalStaked;\n  \n  function stake(uint256 amount) public {\n    // Some logic here\n    for (uint256 i = 0; i < 10; i++) {\n      totalStaked += amount;\n    }\n  }\n}`}
        issues={mockIssues}
      />
      {/* Header */}
      <header className="flex justify-between items-center mb-12">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
            GasGuard Dashboard
          </h1>
          <p className="text-slate-400 mt-2">Security and gas optimization analysis for your smart contracts</p>
        </div>
        <div className="flex gap-4">
          <button className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl font-semibold transition-all flex items-center gap-2">
            <Zap size={20} />
            New Scan
          </button>
        </div>
      </header>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
        <StatCard 
          title="Total Issues" 
          value={MOCK_SUMMARY.totalIssues.toString()} 
          icon={<AlertTriangle className="text-amber-500" />}
          subtitle={`${MOCK_SUMMARY.issuesBySeverity.critical} critical issues found`}
        />
        <StatCard 
          title="Gas Savings" 
          value={`${MOCK_SUMMARY.gasSavings.percentageSaved}%`} 
          icon={<Zap className="text-emerald-500" />}
          subtitle={`~${MOCK_SUMMARY.gasSavings.totalGasSaved.toLocaleString()} gas units`}
        />
        <StatCard 
          title="Files Scanned" 
          value={MOCK_SUMMARY.totalFiles.toString()} 
          icon={<FileCode className="text-blue-500" />}
          subtitle="Across 3 repositories"
        />
        <StatCard 
          title="Security Score" 
          value="84/100" 
          icon={<Shield className="text-indigo-500" />}
          subtitle="Improved by 12pts this week"
        />
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Charts Section */}
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 backdrop-blur-sm">
            <h3 className="text-xl font-semibold mb-6 flex items-center gap-2">
              <BarChart3 size={20} className="text-blue-400" />
              Issue Severity Distribution
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={severityData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                  <XAxis dataKey="name" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                    itemStyle={{ color: '#e2e8f0' }}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {severityData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={SEVERITY_COLORS[entry.name as keyof typeof SEVERITY_COLORS]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 backdrop-blur-sm">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-semibold flex items-center gap-2">
                <Shield size={20} className="text-emerald-400" />
                Latest Findings
              </h3>
              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input 
                  type="text" 
                  placeholder="Filter issues..." 
                  className="pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-4">
              <IssueItem 
                title="Unchecked Arithmetic in loop" 
                severity="critical" 
                file="contracts/Staking.sol" 
                line={142}
                savings="2,400 gas"
                onClick={() => setSelectedFile('contracts/Staking.sol')}
              />
              <IssueItem 
                title="Redundant State Storage" 
                severity="high" 
                file="contracts/Vault.sol" 
                line={89}
                savings="15,000 gas"
                onClick={() => setSelectedFile('contracts/Vault.sol')}
              />
              <IssueItem 
                title="Unused event parameter" 
                severity="low" 
                file="contracts/Token.sol" 
                line={24}
                onClick={() => setSelectedFile('contracts/Token.sol')}
              />
            </div>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="space-y-8">
          <div className="bg-gradient-to-br from-blue-900/20 to-emerald-900/20 border border-blue-500/20 rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Zap size={20} className="text-yellow-400" />
              Gas Optimization Tips
            </h3>
            <ul className="space-y-4 text-sm text-slate-400">
              <li className="flex gap-3">
                <div className="w-1.5 h-1.5 bg-yellow-400 rounded-full mt-1.5 shrink-0" />
                Use <code className="text-blue-300">unchecked</code> for increments in for-loops to save ~80 gas per iteration.
              </li>
              <li className="flex gap-3">
                <div className="w-1.5 h-1.5 bg-yellow-400 rounded-full mt-1.5 shrink-0" />
                Immutable variables are cheaper than constant for state variables that don't change.
              </li>
              <li className="flex gap-3">
                <div className="w-1.5 h-1.5 bg-yellow-400 rounded-full mt-1.5 shrink-0" />
                Consider using <code className="text-blue-300">bytes32</code> instead of <code className="text-blue-300">string</code> for short identifiers.
              </li>
            </ul>
            <button className="w-full mt-6 py-2 border border-blue-500/30 hover:bg-blue-500/10 rounded-lg text-blue-400 text-sm font-medium transition-colors">
              View All Recommendations
            </button>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 backdrop-blur-sm">
            <h3 className="text-lg font-semibold mb-6">Network Health</h3>
            <div className="space-y-4">
              <NetworkStatus name="Ethereum Mainnet" status="optimal" latency="42ms" />
              <NetworkStatus name="Stellar Soroban" status="optimal" latency="12ms" />
              <NetworkStatus name="Polygon" status="congested" latency="180ms" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon, subtitle }: { title: string, value: string, icon: React.ReactNode, subtitle: string }) => (
  <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 backdrop-blur-sm hover:border-slate-700 transition-colors group">
    <div className="flex justify-between items-start mb-4">
      <span className="text-slate-400 text-sm font-medium uppercase tracking-wider">{title}</span>
      <div className="p-2 bg-slate-800 rounded-lg group-hover:scale-110 transition-transform">{icon}</div>
    </div>
    <div className="text-3xl font-bold mb-1">{value}</div>
    <div className="text-xs text-slate-500">{subtitle}</div>
  </div>
);

const IssueItem = ({ title, severity, file, line, savings, onClick }: { title: string, severity: string, file: string, line: number, savings?: string, onClick?: () => void }) => (
  <div 
    onClick={onClick}
    className="p-4 bg-slate-800/30 border border-slate-700/50 rounded-xl hover:bg-slate-800/50 transition-colors cursor-pointer group"
  >
    <div className="flex justify-between items-start">
      <div className="flex gap-4">
        <div className={`mt-1.5 w-2 h-2 rounded-full ${
          severity === 'critical' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' :
          severity === 'high' ? 'bg-orange-500' :
          severity === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
        }`} />
        <div>
          <h4 className="font-medium text-slate-200 group-hover:text-blue-400 transition-colors">{title}</h4>
          <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
            <span className="flex items-center gap-1"><FileCode size={12} /> {file}</span>
            <span>Line {line}</span>
            {savings && <span className="text-emerald-400 font-medium flex items-center gap-1"><Zap size={10} /> {savings} savings</span>}
          </div>
        </div>
      </div>
      <ChevronRight size={18} className="text-slate-600 group-hover:text-slate-400" />
    </div>
  </div>
);

const NetworkStatus = ({ name, status, latency }: { name: string, status: 'optimal' | 'congested' | 'down', latency: string }) => (
  <div className="flex justify-between items-center text-sm">
    <span className="text-slate-300">{name}</span>
    <div className="flex items-center gap-3">
      <span className="text-slate-500 text-xs">{latency}</span>
      <div className={`w-2 h-2 rounded-full ${
        status === 'optimal' ? 'bg-emerald-500' :
        status === 'congested' ? 'bg-amber-500' : 'bg-red-500'
      }`} />
    </div>
  </div>
);
