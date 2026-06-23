import {
  RuleLifecycleMetadata,
  RuleLifecycleStage,
  CompatibilityMetadata,
  DeprecationNotice,
  RuleVersionInfo,
} from './types';

export class RuleLifecycleManager {
  private registry = new Map<string, RuleLifecycleMetadata>();

  register(metadata: RuleLifecycleMetadata): void {
    if (this.registry.has(metadata.ruleId)) {
      throw new Error(`Rule '${metadata.ruleId}' is already registered`);
    }
    this.registry.set(metadata.ruleId, { ...metadata });
  }

  get(ruleId: string): RuleLifecycleMetadata | undefined {
    return this.registry.get(ruleId);
  }

  getAll(): RuleLifecycleMetadata[] {
    return Array.from(this.registry.values());
  }

  getByStage(stage: RuleLifecycleStage): RuleLifecycleMetadata[] {
    return this.getAll().filter(m => m.stage === stage);
  }

  getActive(): RuleLifecycleMetadata[] {
    return this.getByStage('active');
  }

  getDeprecated(): RuleLifecycleMetadata[] {
    return this.getByStage('deprecated');
  }

  getExperimental(): RuleLifecycleMetadata[] {
    return this.getByStage('experimental');
  }

  getSunset(): RuleLifecycleMetadata[] {
    return this.getByStage('sunset');
  }

  getBeta(): RuleLifecycleMetadata[] {
    return this.getByStage('beta');
  }

  deprecate(
    ruleId: string,
    notice: Omit<DeprecationNotice, 'deprecationDate'>,
  ): void {
    const entry = this.ensureExists(ruleId);
    entry.stage = 'deprecated';
    entry.deprecation = {
      ...notice,
      deprecationDate: new Date(),
    };
    entry.updatedDate = new Date();
  }

  addVersion(
    ruleId: string,
    versionInfo: Omit<RuleVersionInfo, 'date'>,
  ): void {
    const entry = this.ensureExists(ruleId);
    const full: RuleVersionInfo = {
      ...versionInfo,
      date: new Date(),
    };
    entry.versions.push(full);
    entry.currentVersion = versionInfo.version;
    entry.updatedDate = new Date();
  }

  updateCompatibility(
    ruleId: string,
    compat: Partial<CompatibilityMetadata>,
  ): void {
    const entry = this.ensureExists(ruleId);
    entry.compatibility = { ...entry.compatibility, ...compat };
    entry.updatedDate = new Date();
  }

  setStage(ruleId: string, stage: RuleLifecycleStage): void {
    const entry = this.ensureExists(ruleId);
    entry.stage = stage;
    entry.updatedDate = new Date();
  }

  remove(ruleId: string): boolean {
    return this.registry.delete(ruleId);
  }

  has(ruleId: string): boolean {
    return this.registry.has(ruleId);
  }

  isDeprecated(ruleId: string): boolean {
    const entry = this.registry.get(ruleId);
    return entry !== undefined && entry.stage === 'deprecated';
  }

  count(): number {
    return this.registry.size;
  }

  clear(): void {
    this.registry.clear();
  }

  private ensureExists(ruleId: string): RuleLifecycleMetadata {
    const entry = this.registry.get(ruleId);
    if (!entry) {
      throw new Error(`Rule '${ruleId}' is not registered`);
    }
    return entry;
  }
}
