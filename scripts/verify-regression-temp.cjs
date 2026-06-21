const { detectMissingAccessControl } = require('./rules/stellar/access-control/detect-missing-access-control.ts');
const { detectWeakRoleHierarchies } = require('./rules/stellar/access-control/detect-weak-role-hierarchies.ts');
const { detectUnsafeCrossContractInvocation } = require('./rules/stellar/cross-contract/detect-unsafe-cross-contract-invocation.ts');
const { detectExcessiveEventTopics } = require('./rules/stellar/events/detect-excessive-event-topics.ts');
const { detectMissingUpgradeGuards } = require('./rules/stellar/upgradeability/detect-missing-upgrade-guards.ts');
const fs = require('fs');
const path = require('path');

const fixturesDir = './tests/regression/security/stellar/fixtures';
const files = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.json'));
let pass = 0, fail = 0;

const detectorMap = {
  'stellar-regression-access-control': detectMissingAccessControl,
  'stellar-regression-weak-role-hierarchy': detectWeakRoleHierarchies,
  'stellar-regression-unsafe-cross-contract': detectUnsafeCrossContractInvocation,
  'stellar-regression-excessive-event-topics': detectExcessiveEventTopics,
  'stellar-regression-missing-upgrade-guards': detectMissingUpgradeGuards,
};

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf-8'));
  const detector = detectorMap[data.id];
  if (!detector) {
    console.log('FAIL ' + data.id + ': no detector');
    fail++;
    continue;
  }
  const expected = data.metadata.expectedTotalViolations;
  const result = detector(data.input);
  const ok = result.detected === (expected > 0);
  const shortMsg = result.message.length > 60 ? result.message.slice(0, 57) + '...' : result.message;
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + data.id + ': detected=' + result.detected + ' expected=' + expected + ' msg="' + shortMsg + '"');
  if (ok) pass++; else fail++;
}

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
