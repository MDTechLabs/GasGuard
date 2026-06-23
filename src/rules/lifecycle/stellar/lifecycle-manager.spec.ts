import { RuleLifecycleManager } from './lifecycle-manager';
import { RuleLifecycleMetadata } from './types';

function makeMetadata(overrides: Partial<RuleLifecycleMetadata> & { ruleId: string }): RuleLifecycleMetadata {
  return {
    name: 'Test Rule',
    slug: 'test-rule',
    stage: 'active',
    currentVersion: '1.0.0',
    versions: [],
    compatibility: {
      engineVersion: '1.0.0',
      stellarSdkVersion: '15.0.0',
      supportedLanguages: ['rust'],
      platformSupport: ['soroban'],
    },
    tags: [],
    createdDate: new Date('2025-01-01'),
    updatedDate: new Date('2025-01-01'),
    ...overrides,
  };
}

describe('RuleLifecycleManager', () => {
  let manager: RuleLifecycleManager;

  beforeEach(() => {
    manager = new RuleLifecycleManager();
  });

  describe('register', () => {
    it('should register a new rule', () => {
      manager.register(makeMetadata({ ruleId: 'test-001' }));
      expect(manager.has('test-001')).toBe(true);
      expect(manager.count()).toBe(1);
    });

    it('should throw when registering a duplicate ruleId', () => {
      manager.register(makeMetadata({ ruleId: 'dup' }));
      expect(() => manager.register(makeMetadata({ ruleId: 'dup' }))).toThrow(
        /already registered/,
      );
    });
  });

  describe('get', () => {
    it('should return metadata for a registered rule', () => {
      const meta = makeMetadata({ ruleId: 'get-001', name: 'Getter Rule' });
      manager.register(meta);
      const result = manager.get('get-001');
      expect(result).toBeDefined();
      expect(result!.name).toBe('Getter Rule');
    });

    it('should return undefined for unregistered rule', () => {
      expect(manager.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return all registered rules', () => {
      manager.register(makeMetadata({ ruleId: 'a' }));
      manager.register(makeMetadata({ ruleId: 'b' }));
      expect(manager.getAll()).toHaveLength(2);
    });

    it('should return empty array when no rules registered', () => {
      expect(manager.getAll()).toEqual([]);
    });
  });

  describe('getByStage', () => {
    it('should filter rules by lifecycle stage', () => {
      manager.register(makeMetadata({ ruleId: 'active-1', stage: 'active' }));
      manager.register(makeMetadata({ ruleId: 'dep-1', stage: 'deprecated' }));
      manager.register(makeMetadata({ ruleId: 'exp-1', stage: 'experimental' }));
      manager.register(makeMetadata({ ruleId: 'beta-1', stage: 'beta' }));
      manager.register(makeMetadata({ ruleId: 'sunset-1', stage: 'sunset' }));

      expect(manager.getByStage('active')).toHaveLength(1);
      expect(manager.getByStage('deprecated')).toHaveLength(1);
      expect(manager.getByStage('experimental')).toHaveLength(1);
      expect(manager.getByStage('beta')).toHaveLength(1);
      expect(manager.getByStage('sunset')).toHaveLength(1);
    });
  });

  describe('stage accessors', () => {
    it('getActive, getDeprecated, getExperimental, getBeta, getSunset', () => {
      manager.register(makeMetadata({ ruleId: 'a', stage: 'active' }));
      manager.register(makeMetadata({ ruleId: 'd', stage: 'deprecated' }));
      manager.register(makeMetadata({ ruleId: 'e', stage: 'experimental' }));
      manager.register(makeMetadata({ ruleId: 'b', stage: 'beta' }));
      manager.register(makeMetadata({ ruleId: 's', stage: 'sunset' }));

      expect(manager.getActive()).toHaveLength(1);
      expect(manager.getDeprecated()).toHaveLength(1);
      expect(manager.getExperimental()).toHaveLength(1);
      expect(manager.getBeta()).toHaveLength(1);
      expect(manager.getSunset()).toHaveLength(1);
    });
  });

  describe('deprecate', () => {
    it('should deprecate a registered rule with a notice', () => {
      manager.register(makeMetadata({ ruleId: 'dep-me' }));
      manager.deprecate('dep-me', {
        deprecatedInVersion: '2.0.0',
        removalVersion: '3.0.0',
        alternative: 'new-rule',
        reason: 'Superseded',
      });

      const meta = manager.get('dep-me');
      expect(meta!.stage).toBe('deprecated');
      expect(meta!.deprecation).toBeDefined();
      expect(meta!.deprecation!.deprecatedInVersion).toBe('2.0.0');
      expect(meta!.deprecation!.alternative).toBe('new-rule');
      expect(meta!.deprecation!.deprecationDate).toBeInstanceOf(Date);
    });

    it('should throw when deprecating an unregistered rule', () => {
      expect(() =>
        manager.deprecate('unknown', {
          deprecatedInVersion: '1.0.0',
          reason: 'test',
        }),
      ).toThrow(/not registered/);
    });
  });

  describe('addVersion', () => {
    it('should add a version to a registered rule', () => {
      manager.register(makeMetadata({ ruleId: 'v-rule' }));
      manager.addVersion('v-rule', {
        version: '1.1.0',
        changelog: 'Bug fixes',
        breaking: false,
      });

      const meta = manager.get('v-rule');
      expect(meta!.versions).toHaveLength(1);
      expect(meta!.currentVersion).toBe('1.1.0');
      expect(meta!.versions[0].date).toBeInstanceOf(Date);
    });

    it('should append multiple versions in order', () => {
      manager.register(makeMetadata({ ruleId: 'multi-v' }));
      manager.addVersion('multi-v', {
        version: '1.0.0',
        changelog: 'Initial',
        breaking: false,
      });
      manager.addVersion('multi-v', {
        version: '2.0.0',
        changelog: 'Breaking changes',
        breaking: true,
      });

      const meta = manager.get('multi-v');
      expect(meta!.versions).toHaveLength(2);
      expect(meta!.currentVersion).toBe('2.0.0');
    });

    it('should throw when adding version to unregistered rule', () => {
      expect(() =>
        manager.addVersion('unknown', {
          version: '1.0.0',
          changelog: 'test',
          breaking: false,
        }),
      ).toThrow(/not registered/);
    });
  });

  describe('updateCompatibility', () => {
    it('should update compatibility metadata', () => {
      manager.register(makeMetadata({ ruleId: 'compat' }));
      manager.updateCompatibility('compat', {
        engineVersion: '2.0.0',
        supportedLanguages: ['rust', 'solidity'],
      });

      const meta = manager.get('compat');
      expect(meta!.compatibility.engineVersion).toBe('2.0.0');
      expect(meta!.compatibility.stellarSdkVersion).toBe('15.0.0');
      expect(meta!.compatibility.supportedLanguages).toEqual(['rust', 'solidity']);
    });

    it('should throw when updating unregistered rule', () => {
      expect(() =>
        manager.updateCompatibility('unknown', { engineVersion: '1.0.0' }),
      ).toThrow(/not registered/);
    });
  });

  describe('setStage', () => {
    it('should change the lifecycle stage', () => {
      manager.register(makeMetadata({ ruleId: 'stageable', stage: 'active' }));
      manager.setStage('stageable', 'beta');
      expect(manager.get('stageable')!.stage).toBe('beta');
    });
  });

  describe('remove', () => {
    it('should remove a registered rule and return true', () => {
      manager.register(makeMetadata({ ruleId: 'remove-me' }));
      expect(manager.remove('remove-me')).toBe(true);
      expect(manager.has('remove-me')).toBe(false);
    });

    it('should return false for unregistered rule', () => {
      expect(manager.remove('ghost')).toBe(false);
    });
  });

  describe('isDeprecated', () => {
    it('should return true for deprecated rules', () => {
      manager.register(makeMetadata({ ruleId: 'oldie', stage: 'deprecated' }));
      expect(manager.isDeprecated('oldie')).toBe(true);
    });

    it('should return false for non-deprecated rules', () => {
      manager.register(makeMetadata({ ruleId: 'newbie', stage: 'active' }));
      expect(manager.isDeprecated('newbie')).toBe(false);
    });

    it('should return false for unregistered rules', () => {
      expect(manager.isDeprecated('missing')).toBe(false);
    });
  });

  describe('count / clear', () => {
    it('should return 0 after clear', () => {
      manager.register(makeMetadata({ ruleId: 'x' }));
      expect(manager.count()).toBe(1);
      manager.clear();
      expect(manager.count()).toBe(0);
    });
  });
});
