# General Rules

## unused-state-variables

**Rule ID:** `unusedstatevariablesrule`

**Language:** rs

**Category:** general

**Severity:** medium

### Description

Identifies state variables in Soroban contracts that are never read or written to, helping developers minimize storage footprint and ledger rent.

### Implementation

**File:** `packages\rules\src\unused_state_variables.rs`

---

