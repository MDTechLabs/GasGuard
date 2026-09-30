import { CliCompletionService } from '../completion';

describe('CLI Shell Completion Service (#1058)', () => {
  it('generates bash completion script correctly', () => {
    const script = CliCompletionService.generateCompletionScript('bash');
    expect(script).toContain('_gasguard_completions');
    expect(script).toContain('complete -F _gasguard_completions gasguard');
  });

  it('generates zsh completion script correctly', () => {
    const script = CliCompletionService.generateCompletionScript('zsh');
    expect(script).toContain('#compdef gasguard');
    expect(script).toContain('_gasguard');
  });

  it('generates fish completion script correctly', () => {
    const script = CliCompletionService.generateCompletionScript('fish');
    expect(script).toContain('complete -c gasguard');
  });

  it('throws an error for unsupported shell types', () => {
    expect(() => {
      CliCompletionService.generateCompletionScript('powershell' as any);
    }).toThrow('Unsupported shell type: powershell');
  });
});