pragma solidity ^0.8.28;

contract Counter {
    uint256 transient counter;

    function bump() external {
        counter += 1;
    }
}
