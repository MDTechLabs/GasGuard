import React from 'react';
import { X, Code2, AlertCircle, CheckCircle2 } from 'lucide-react';

interface FileDetailsProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  content: string;
  issues: any[];
}

export const FileDetails: React.FC<FileDetailsProps> = ({ isOpen, onClose, fileName, content, issues }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-sm">
      <div className="h-full w-full max-w-4xl bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Code2 className="text-blue-400" size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-100">{fileName}</h2>
              <p className="text-sm text-slate-500">{issues.length} issues identified</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-slate-100"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Code View */}
          <div className="flex-1 overflow-auto bg-[#0b1120] p-6 font-mono text-sm">
            <pre className="text-slate-300">
              {content.split('\n').map((line, i) => {
                const lineIssue = issues.find(iss => iss.location.line === i + 1);
                return (
                  <div key={i} className={`flex gap-4 ${lineIssue ? 'bg-red-500/10 -mx-6 px-6' : ''}`}>
                    <span className="w-12 text-slate-600 text-right select-none">{i + 1}</span>
                    <span className="whitespace-pre">{line}</span>
                  </div>
                );
              })}
            </pre>
          </div>

          {/* Issues Sidebar */}
          <div className="w-80 border-l border-slate-800 overflow-auto bg-slate-900/50 p-6 space-y-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Analysis Findings</h3>
            {issues.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <CheckCircle2 size={48} className="text-emerald-500 mb-4 opacity-20" />
                <p className="text-slate-400">No issues found in this file</p>
              </div>
            ) : (
              issues.map((issue, idx) => (
                <div key={idx} className="p-4 bg-slate-800/50 border border-slate-700 rounded-xl space-y-3">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={16} className={
                      issue.severity === 'critical' ? 'text-red-500' :
                      issue.severity === 'high' ? 'text-orange-500' :
                      'text-yellow-500'
                    } />
                    <span className="text-xs font-bold uppercase tracking-tighter text-slate-400">{issue.severity}</span>
                  </div>
                  <h4 className="text-sm font-semibold text-slate-200">{issue.title}</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">{issue.description}</p>
                  {issue.recommendation && (
                    <div className="pt-2">
                      <p className="text-[10px] font-bold text-blue-400 uppercase mb-1">Recommendation</p>
                      <p className="text-[11px] text-slate-300 italic">{issue.recommendation}</p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
