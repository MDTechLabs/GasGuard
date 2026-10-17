/**
 * Analyzer plugin contract and lifecycle (#1154).
 *
 * A plugin declares its identity, the analyzer version it targets and optional
 * lifecycle hooks. Plugins move through a small closed set of states:
 *
 *   registered -> initialized -> ready -> disposed
 *
 * Every transition is validated, so a plugin cannot be marked ready before it
 * has initialised, or be used again after disposal. Initialisation and disposal
 * are only performed once even if the hooks are called repeatedly.
 *
 * The lifecycle object performs no I/O and holds no global state; callers own
 * plugin wiring, and the same object can be constructed per analysis run so
 * plugin state never leaks between tenants.
 */

export type AnalyzerPluginState =
  | "registered"
  | "initialized"
  | "ready"
  | "disposed";

export interface AnalyzerPluginContext {
  /** GasGuard version the plugin was loaded by. */
  readonly gasguardVersion: string;
  /** Working directory plugins may resolve relative paths against. */
  readonly workdir: string;
}

export interface AnalyzerPlugin {
  readonly name: string;
  readonly version: string;
  /** Hook invoked once when the plugin enters "initialized". */
  initialize?(context: AnalyzerPluginContext): void | Promise<void>;
  /** Hook invoked once when the plugin enters "disposed". */
  dispose?(): void | Promise<void>;
}

export const ALLOWED_PLUGIN_TRANSITIONS: Record<
  AnalyzerPluginState,
  readonly AnalyzerPluginState[]
> = {
  registered: ["initialized", "disposed"],
  initialized: ["ready", "disposed"],
  ready: ["disposed"],
  disposed: [],
};

export class AnalyzerPluginLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzerPluginLifecycleError";
  }
}

export class AnalyzerPluginLifecycle {
  private readonly plugins = new Map<string, AnalyzerPlugin>();
  private readonly states = new Map<string, AnalyzerPluginState>();

  constructor(private readonly context: AnalyzerPluginContext) {}

  /** Register a plugin in the "registered" state. Names must be unique. */
  register(plugin: AnalyzerPlugin): void {
    requireNonEmpty(plugin?.name, "plugin.name");
    if (this.plugins.has(plugin.name)) {
      throw new AnalyzerPluginLifecycleError(
        `plugin ${plugin.name} is already registered`,
      );
    }
    this.plugins.set(plugin.name, plugin);
    this.states.set(plugin.name, "registered");
  }

  stateOf(name: string): AnalyzerPluginState | undefined {
    return this.states.get(name);
  }

  /** Run the plugin's initialise hook and move it to "initialized". */
  async initialize(name: string): Promise<AnalyzerPluginState> {
    const plugin = this.requirePlugin(name);
    this.transition(name, "initialized");
    await plugin.initialize?.(this.context);
    return "initialized";
  }

  /** Mark an initialised plugin as ready to serve analysis requests. */
  markReady(name: string): AnalyzerPluginState {
    this.transition(name, "ready");
    return "ready";
  }

  /** Run the plugin's dispose hook and move it to "disposed". */
  async dispose(name: string): Promise<AnalyzerPluginState> {
    const plugin = this.requirePlugin(name);
    this.transition(name, "disposed");
    await plugin.dispose?.();
    return "disposed";
  }

  /** Names of every registered plugin, in registration order. */
  registeredPlugins(): string[] {
    return [...this.plugins.keys()];
  }

  private requirePlugin(name: string): AnalyzerPlugin {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new AnalyzerPluginLifecycleError(`plugin ${String(name)} is not registered`);
    }
    return plugin;
  }

  private transition(name: string, next: AnalyzerPluginState): void {
    const current = this.states.get(name) ?? "registered";
    if (!ALLOWED_PLUGIN_TRANSITIONS[current].includes(next)) {
      throw new AnalyzerPluginLifecycleError(
        `plugin ${name} cannot move from ${current} to ${next}`,
      );
    }
    this.states.set(name, next);
  }
}

function requireNonEmpty(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AnalyzerPluginLifecycleError(`${field} must be a non-empty string`);
  }
}
