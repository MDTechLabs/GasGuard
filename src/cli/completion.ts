import { logger } from '../utils/logger';

export type ShellType = 'bash' | 'zsh' | 'fish';

export class CliCompletionService {
  /**
   * Generates the shell completion script for the specified shell
   */
  static generateCompletionScript(shell: ShellType): string {
    switch (shell) {
      case 'bash':
        return `
# GasGuard Bash Completion
_gasguard_completions() {
    local cur prev opts
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    opts="analyze audit policy simulate verify completion --help --version"
    COMPREPLY=( $(compgen -W "\${opts}" -- \${cur}) )
    return 0
}
complete -F _gasguard_completions gasguard
        `.trim();

      case 'zsh':
        return `
#compdef gasguard
# GasGuard Zsh Completion
_gasguard() {
    local -a opts
    opts=(
      'analyze:Analyze smart contract gas consumption'
      'audit:Audit smart contracts for security vulnerabilities'
      'policy:Manage gas and security policies'
      'simulate:Simulate transaction execution'
      'verify:Verify proof compliance'
      'completion:Generate shell completion scripts'
    )
    _arguments '1: :->command' '*::arg:->args'
    case "$state" in
      command)
        _describe 'command' opts
        ;;
    es}
}
compdef _gasguard gasguard
        `.trim();

      case 'fish':
        return `
# GasGuard Fish Completion
complete -c gasguard -n "__fish_use_subcommand" -a "analyze audit policy simulate verify completion"
        `.trim();

      default:
        throw new Error(`Unsupported shell type: ${shell}. Supported shells are: bash, zsh, fish.`);
    }
  }
}