/**
 * Soroban Rule Validation Test Datasets
 *
 * Contains known-good and known-bad Soroban contract samples for rule validation.
 * Each dataset includes input source code and the expected findings the rule
 * should produce.
 */

export interface ExpectedFinding {
  ruleId: string;
  severity: string;
  messagePattern: string;
  line?: number;
}

export interface TestSample {
  id: string;
  name: string;
  description: string;
  input: string;
  expectedFindings: ExpectedFinding[];
}

export interface TestDataset {
  id: string;
  name: string;
  description: string;
  samples: TestSample[];
}

export function createTestDataset(
  id: string,
  name: string,
  description: string,
  samples: TestSample[],
): TestDataset {
  return { id, name, description, samples };
}

export const ownershipTestDataset: TestDataset = createTestDataset(
  "stellar-ownership",
  "Stellar Ownership Pattern Detection",
  "Tests for detecting ownership patterns and admin functions in Soroban contracts",
  [
    {
      id: "ownership-known-good-1",
      name: "Contract with proper owner authentication",
      description: "A contract where admin functions properly authenticate the owner",
      input: `
use soroban_sdk::{contract, contractimpl, Address};

#[contractimpl]
impl SecureContract {
    pub fn new(owner: Address) -> Self {
        Self { owner }
    }

    pub fn admin_operation(&mut self, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        if caller != self.owner {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }
}
`,
      expectedFindings: [
        { ruleId: "stellar-ownership-pattern", severity: "low", messagePattern: "single-owner" },
        { ruleId: "stellar-admin-auth", severity: "low", messagePattern: "require_auth" },
      ],
    },
    {
      id: "ownership-known-bad-1",
      name: "Admin function without authentication",
      description: "A contract with admin functions missing authentication checks",
      input: `
use soroban_sdk::{contract, contractimpl, Address};

#[contractimpl]
impl InsecureContract {
    pub fn new(owner: Address) -> Self {
        Self { owner }
    }

    pub fn set_owner(&mut self, new_owner: Address) {
        self.owner = new_owner;
    }

    pub fn withdraw(&mut self, to: Address, amount: u64) {
        to.balance += amount;
    }
}
`,
      expectedFindings: [
        {
          ruleId: "stellar-missing-auth",
          severity: "critical",
          messagePattern: "set_owner",
        },
        {
          ruleId: "stellar-missing-auth",
          severity: "critical",
          messagePattern: "withdraw",
        },
      ],
    },
  ],
);

export const accessControlTestDataset: TestDataset = createTestDataset(
  "stellar-access-control",
  "Stellar Access Control Detection",
  "Tests for detecting access control mechanisms in Soroban contracts",
  [
    {
      id: "acl-known-good-1",
      name: "Contract with role-based access control",
      description: "A contract using role-based access control with proper checks",
      input: `
use soroban_sdk::{contract, contractimpl, Address};

#[contractimpl]
impl RBACContract {
    pub fn new(admin: Address) -> Self {
        Self { admin }
    }

    pub fn admin_only(&mut self) -> Result<(), Error> {
        self.admin.require_auth();
        Ok(())
    }
}
`,
      expectedFindings: [
        { ruleId: "stellar-access-control", severity: "low", messagePattern: "role-based" },
      ],
    },
  ],
);

export const timeLockTestDataset: TestDataset = createTestDataset(
  "stellar-time-lock",
  "Stellar Time-Lock Detection",
  "Tests for detecting time-locked operations in Soroban contracts",
  [
    {
      id: "timelock-known-good-1",
      name: "Contract with time-locked upgrade",
      description: "A contract that uses time-locks for sensitive operations",
      input: `
use soroban_sdk::{contract, contractimpl, Address, Env};

#[contractimpl]
impl TimelockContract {
    pub fn schedule_upgrade(&mut self, env: Env, implementation: Address) {
        self.owner.require_auth();
        let deadline = env.ledger().timestamp() + self.delay;
    }
}
`,
      expectedFindings: [
        { ruleId: "stellar-time-lock", severity: "info", messagePattern: "delay" },
      ],
    },
  ],
);

export const allDatasets: TestDataset[] = [
  ownershipTestDataset,
  accessControlTestDataset,
  timeLockTestDataset,
];
