import fs from 'fs';
import path from 'path';

export interface WatcherOptions {
  ignored?: (path: string) => boolean;
  debounceMs?: number;
}

export class ScanWatcher {
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private onChangeCallback?: (filePath: string) => void;

  constructor(private readonly baseDir: string, private readonly options: WatcherOptions = {}) {}

  /**
   * Starts watching the given directory for file changes.
   */
  public watch(onChange: (filePath: string) => void): void {
    this.onChangeCallback = onChange;
    console.log(`[Watch Mode] Starting watcher on ${this.baseDir}`);
    this.watchDirectory(this.baseDir);
  }

  /**
   * Stops watching all directories.
   */
  public stop(): void {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    console.log('[Watch Mode] Stopped.');
  }

  private watchDirectory(dir: string): void {
    if (this.options.ignored && this.options.ignored(dir)) {
      return;
    }

    try {
      // Setup watcher for current directory
      const watcher = fs.watch(dir, (eventType, filename) => {
        if (!filename) return;
        const fullPath = path.join(dir, filename.toString());
        
        if (this.options.ignored && this.options.ignored(fullPath)) {
          return;
        }

        // Debounce the change events
        this.debounceEvent(fullPath);
      });

      this.watchers.set(dir, watcher);

      // Recursively watch subdirectories
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const fullPath = path.join(dir, entry.name);
          this.watchDirectory(fullPath);
        }
      }
    } catch (err) {
      console.warn(`[Watch Mode] Could not watch directory ${dir}: ${err}`);
    }
  }

  private debounceEvent(filePath: string): void {
    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      if (this.onChangeCallback) {
        this.onChangeCallback(filePath);
      }
    }, this.options.debounceMs || 300);

    this.debounceTimers.set(filePath, timer);
  }
}
