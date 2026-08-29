// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract G017Sample {
    enum ActionState { PENDING, ACTIVE, COMPLETED, CANCELLED }
    enum Phase { INIT, RUNNING, DONE }

    // Flagged: for-loop casts its index into an enum on every iteration.
    function iterateEnum() external pure {
        for (uint8 i = 0; i < 4; i++) {
            ActionState state = ActionState(i);
        }
    }

    // Flagged: while-loop casts its index into an enum on every iteration.
    function iterateEnumWhile() external pure {
        uint8 i = 0;
        while (i < 3) {
            Phase p = Phase(i);
            i++;
        }
    }

    // Flagged: nested loops, inner loop casts into an enum.
    function iterateEnumNested() external pure {
        for (uint8 i = 0; i < 2; i++) {
            for (uint8 j = 0; j < 4; j++) {
                ActionState state = ActionState(j);
            }
        }
    }

    // Not flagged: plain integer-index loop with no enum casting.
    function sum(uint256[] memory arr) external pure returns (uint256 total) {
        for (uint256 i = 0; i < arr.length; i++) {
            total += arr[i];
        }
    }

    // Not flagged: enum cast happens once, outside of any loop.
    function single(uint8 i) external pure returns (ActionState) {
        return ActionState(i);
    }
}
