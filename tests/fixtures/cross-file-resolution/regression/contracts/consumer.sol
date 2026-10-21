pragma solidity ^0.8.20;

import {Base} from "./mid.sol";
import "./dupA.sol";
import "./dupB.sol";
import "./missing.sol";

/* Base appears in this block comment and must not count. */
contract Consumer is Base {
    string public note = "Base and Shared in a string";
    Shared public shared;
}
