import { parentPort, workerData } from 'worker_threads';

export interface ScanJobTask {
  filePath: string;
  content: string;
}

export interface ScanJobResult {
  filePath: string;
  astNodesCount: number;
  warningsCount: number;
  durationMs: number;
}

if (parentPort) {
  parentPort.on('message', (task: ScanJobTask) => {
    const startTime = Date.now();

    const lineCount = task.content ? task.content.split('\n').length : 1;
    const astNodesCount = Math.max(1, Math.floor(lineCount * 2.5));

    let warningsCount = 0;
    if (task.content && task.content.includes('.length') && (task.content.includes('for') || task.content.includes('while'))) {
      warningsCount++;
    }
    if (task.content && task.content.includes('env.storage().persistent()')) {
      warningsCount++;
    }
    if (task.content && /\d+\s*[+\-*/%]\s*\d+/.test(task.content)) {
      warningsCount++;
    }

    const durationMs = Date.now() - startTime;

    const result: ScanJobResult = {
      filePath: task.filePath,
      astNodesCount,
      warningsCount,
      durationMs,
    };

    parentPort?.postMessage(result);
  });
}
